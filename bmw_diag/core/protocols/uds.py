"""BMW K+DCAN Diagnostic Tool - UDS Protocol Implementation"""

import struct
import time
from typing import Optional, List, Tuple, Dict
from dataclasses import dataclass

from bmw_diag.core.constants import (
    UDSServiceID, UDSDataIdentifier, SessionType, NegativeResponseCode,
    UDS_P2_TIMEOUT, UDS_P2_STAR_TIMEOUT
)
from bmw_diag.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class UDSMessage:
    """Represents a UDS (ISO 14229) diagnostic message."""
    service: int         # Service ID
    data: bytes          # Payload data (may include sub-function)
    
    # UDS uses ISO-TP (ISO 15765-2) for transport over CAN
    # Single Frame (SF): 0x0L, data... (L = length, up to 7 bytes)
    # First Frame (FF): 0x1L, 0xLL, data... (L = 12-bit length)
    # Consecutive Frame (CF): 0x2N, data... (N = sequence 0-15)
    # Flow Control (FC): 0x30, BS, ST, ... (Block Size, Separation Time)
    
    def __init__(self, service: int = 0, data: bytes = b""):
        self.service = service & 0xFF
        self.data = data
    
    def to_bytes(self) -> bytes:
        return bytes([self.service]) + self.data
    
    @classmethod
    def from_bytes(cls, raw: bytes) -> Optional["UDSMessage"]:
        if len(raw) < 1:
            return None
        return cls(service=raw[0], data=raw[1:])
    
    @property
    def is_positive_response(self) -> bool:
        return (self.service & 0x40) != 0 and self.service != 0x7F
    
    @property
    def is_negative_response(self) -> bool:
        return self.service == 0x7F
    
    @property
    def response_service(self) -> int:
        return self.service - 0x40 if self.is_positive_response else self.service
    
    @property
    def negative_service(self) -> Optional[int]:
        if self.is_negative_response and len(self.data) >= 1:
            return self.data[0]
        return None
    
    @property
    def negative_code(self) -> Optional[int]:
        if self.is_negative_response and len(self.data) >= 2:
            return self.data[1]
        return None
    
    def __repr__(self) -> str:
        return f"UDSMessage(service=0x{self.service:02X}, data={self.data.hex()})"


class ISOTPTransport:
    """ISO-TP (ISO 15765-2) transport over CAN."""
    
    # CAN frame type indicators
    SF = 0x00  # Single Frame (data[0] & 0xF0 == 0x00)
    FF = 0x10  # First Frame (data[0] & 0xF0 == 0x10)
    CF = 0x20  # Consecutive Frame (data[0] & 0xF0 == 0x20)
    FC = 0x30  # Flow Control (data[0] & 0xF0 == 0x30)
    
    def __init__(self, can_interface, tx_id: int, rx_id: int, block_size: int = 0, st_min: int = 0):
        self.can = can_interface
        self.tx_id = tx_id
        self.rx_id = rx_id
        self.block_size = block_size
        self.st_min = st_min  # Separation time minimum (ms)
    
    def _send_single_frame(self, data: bytes) -> None:
        """Send a single CAN frame with data (up to 7 bytes)."""
        length = len(data)
        if length > 7:
            raise ValueError("Single frame data exceeds 7 bytes")
        frame = bytes([length]) + data + bytes(7 - length)
        self.can.send(self.tx_id, frame)
    
    def _send_multi_frame(self, data: bytes) -> None:
        """Send multi-frame message using ISO-TP."""
        length = len(data)
        # First frame: 0x1L LL + 6 bytes data
        ff = bytes([0x10 | ((length >> 8) & 0x0F), length & 0xFF]) + data[:6]
        ff += bytes(8 - len(ff))
        self.can.send(self.tx_id, ff)
        
        # Wait for flow control
        fc = self.can.receive(self.rx_id, timeout_ms=1000)
        if not fc or (fc[0] & 0xF0) != 0x30:
            raise RuntimeError("No flow control received")
        
        bs = fc[1]
        st = fc[2]
        
        # Send consecutive frames
        seq = 1
        idx = 6
        while idx < length:
            chunk = data[idx:idx + 7]
            cf = bytes([0x20 | (seq & 0x0F)]) + chunk + bytes(7 - len(chunk))
            self.can.send(self.tx_id, cf)
            seq = (seq + 1) & 0x0F
            idx += 7
            if st > 0 and st < 0x80:
                time.sleep(st / 1000.0)
            elif st >= 0xF1 and st <= 0xF9:
                time.sleep((st - 0xF0) / 10000.0)
    
    def send(self, data: bytes) -> None:
        """Send data via ISO-TP."""
        if len(data) <= 7:
            self._send_single_frame(data)
        else:
            self._send_multi_frame(data)
    
    def receive(self, timeout_ms: int = 1000) -> Optional[bytes]:
        """Receive a complete ISO-TP message."""
        deadline = time.time() + (timeout_ms / 1000.0)
        buffer = bytearray()
        expected_length = 0
        seq = 0
        state = "idle"
        
        while time.time() < deadline:
            frame = self.can.receive(self.rx_id, timeout_ms=100)
            if not frame:
                continue
            
            pci = frame[0] & 0xF0
            
            if pci == 0x00:  # Single frame
                length = frame[0] & 0x0F
                return bytes(frame[1:1 + length])
            
            elif pci == 0x10:  # First frame
                expected_length = ((frame[0] & 0x0F) << 8) | frame[1]
                buffer = bytearray(frame[2:8])
                state = "receiving"
                # Send flow control
                fc = bytes([0x30, self.block_size, self.st_min]) + bytes(5)
                self.can.send(self.tx_id, fc)
                seq = 0
            
            elif pci == 0x20:  # Consecutive frame
                if state != "receiving":
                    continue
                cf_seq = frame[0] & 0x0F
                if cf_seq != ((seq + 1) & 0x0F):
                    logger.warning(f"ISO-TP sequence error: expected {seq+1}, got {cf_seq}")
                seq = cf_seq
                buffer.extend(frame[1:8])
                if len(buffer) >= expected_length:
                    return bytes(buffer[:expected_length])
            
            elif pci == 0x30:  # Flow control
                # We shouldn't receive FC as the receiver
                pass
        
        return None


class UDSProtocol:
    """UDS protocol handler for BMW diagnostics (F-series and newer)."""
    
    def __init__(self, isotp_transport: ISOTPTransport, timeout_ms: int = UDS_P2_TIMEOUT):
        self.isotp = isotp_transport
        self.timeout_ms = timeout_ms
        self.current_session = SessionType.DEFAULT
    
    def _send_and_receive(self, service: int, data: bytes = b"",
                          timeout_override: Optional[int] = None) -> Optional[UDSMessage]:
        """Send UDS request and receive response."""
        req = UDSMessage(service=service, data=data)
        raw = req.to_bytes()
        
        logger.debug(f"UDS TX -> {raw.hex()}")
        self.isotp.send(raw)
        
        timeout = timeout_override or self.timeout_ms
        resp_raw = self.isotp.receive(timeout_ms=timeout)
        
        if not resp_raw:
            logger.warning(f"UDS: No response for service 0x{service:02X}")
            return None
        
        logger.debug(f"UDS RX <- {resp_raw.hex()}")
        resp = UDSMessage.from_bytes(resp_raw)
        
        # Handle negative response with requestCorrectlyReceived-ResponsePending (0x78)
        if resp and resp.is_negative_response and resp.negative_code == 0x78:
            # Wait for final response with extended timeout
            resp_raw = self.isotp.receive(timeout_ms=UDS_P2_STAR_TIMEOUT)
            if resp_raw:
                resp = UDSMessage.from_bytes(resp_raw)
        
        return resp
    
    # ── High-level UDS services ────────────────────────────────────────
    
    def start_session(self, session_type: SessionType = SessionType.DEFAULT) -> bool:
        """Start a diagnostic session."""
        resp = self._send_and_receive(UDSServiceID.DIAGNOSTIC_SESSION_CONTROL,
                                       bytes([session_type.value]))
        if resp and resp.is_positive_response:
            self.current_session = session_type
            return True
        return False
    
    def ecu_reset(self, reset_type: int = 0x01) -> bool:
        """Reset ECU."""
        resp = self._send_and_receive(UDSServiceID.ECU_RESET, bytes([reset_type]))
        return resp is not None and resp.is_positive_response
    
    def read_dtc(self, status_mask: int = 0xFF) -> List[Dict]:
        """Read DTC information. Returns list of dicts with DTC, status, and description."""
        # Use sub-function 0x02: report DTC by status mask
        resp = self._send_and_receive(UDSServiceID.READ_DTC_INFORMATION,
                                       bytes([0x02, status_mask]))
        if not resp or not resp.is_positive_response:
            return []
        
        dtcs = []
        data = resp.data[1:]  # Skip sub-function echo
        for i in range(0, len(data), 4):
            if i + 3 < len(data):
                dtc = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
                status = data[i + 3]
                dtcs.append({
                    'dtc': dtc,
                    'status': status,
                    'hex': f"0x{dtc:06X}"
                })
        return dtcs
    
    def clear_dtc(self, group: int = 0xFFFFFF) -> bool:
        """Clear diagnostic information."""
        resp = self._send_and_receive(UDSServiceID.CLEAR_DIAGNOSTIC_INFORMATION,
                                       struct.pack('>I', group)[1:])  # 3 bytes
        return resp is not None and resp.is_positive_response
    
    def read_data_by_id(self, did: int) -> Optional[bytes]:
        """Read data by identifier (DID)."""
        resp = self._send_and_receive(UDSServiceID.READ_DATA_BY_IDENTIFIER,
                                       struct.pack('>H', did))
        if resp and resp.is_positive_response:
            return resp.data[2:] if len(resp.data) > 2 else resp.data
        return None
    
    def read_vin(self) -> Optional[str]:
        """Read VIN from DID 0xF190."""
        data = self.read_data_by_id(UDSDataIdentifier.VIN)
        if data:
            return data.decode('ascii', errors='ignore').strip()
        return None
    
    def read_ecu_sw_version(self) -> Optional[str]:
        """Read ECU software version."""
        data = self.read_data_by_id(UDSDataIdentifier.ECU_SOFTWARE_VERSION)
        if data:
            return data.decode('ascii', errors='ignore').strip()
        return None
    
    def read_ecu_hw_version(self) -> Optional[str]:
        """Read ECU hardware version."""
        data = self.read_data_by_id(UDSDataIdentifier.ECU_HARDWARE_VERSION)
        if data:
            return data.decode('ascii', errors='ignore').strip()
        return None
    
    def security_access_request_seed(self, level: int) -> Optional[bytes]:
        """Request security access seed."""
        resp = self._send_and_receive(UDSServiceID.SECURITY_ACCESS, bytes([level]))
        if resp and resp.is_positive_response and len(resp.data) > 1:
            return resp.data[1:]
        return None
    
    def security_access_send_key(self, level: int, key: bytes) -> bool:
        """Send security key."""
        resp = self._send_and_receive(UDSServiceID.SECURITY_ACCESS,
                                       bytes([level]) + key)
        return resp is not None and resp.is_positive_response
    
    def tester_present(self, suppress_response: bool = False) -> bool:
        """Send tester present."""
        subfunc = 0x80 if suppress_response else 0x00
        resp = self._send_and_receive(UDSServiceID.TESTER_PRESENT, bytes([subfunc]))
        return resp is not None
    
    def control_dtc(self, enable: bool) -> bool:
        """Enable or disable DTC setting."""
        subfunc = 0x01 if enable else 0x02
        resp = self._send_and_receive(UDSServiceID.CONTROL_DTC_SETTING, bytes([subfunc]))
        return resp is not None and resp.is_positive_response
