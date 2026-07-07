"""BMW K+DCAN Diagnostic Tool - KWP2000 Protocol Implementation"""

import struct
import time
from typing import Optional, List, Tuple, Callable
from dataclasses import dataclass

from bmw_diag.core.constants import (
    KWPServiceID, SessionType, NegativeResponseCode,
    ECUAddress, KWP_T1_MAX, KWP_T2_MAX, KWP_T3_MAX,
    P2_DEFAULT_TIMEOUT, P2_EXTENDED_TIMEOUT
)
from bmw_diag.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class KWPMessage:
    """Represents a KWP2000 diagnostic message."""
    target: int          # Target ECU address
    source: int          # Source (tester) address (default 0xF1 = tester)
    service: int         # Service ID
    data: bytes          # Payload data (without service byte)
    
    # KWP2000 physical layer formats:
    # Format 1: len, target, source, data..., checksum (len < 64)
    # Format 2: 0x80, target, source, len, data..., checksum (len >= 64 or forced)
    # Format 3: 0x80, target, source, 0x00, len_hi, len_lo, data..., checksum (for long)
    
    def __init__(self, target: int, source: int = 0xF1, service: int = 0, data: bytes = b""):
        self.target = target & 0xFF
        self.source = source & 0xFF
        self.service = service & 0xFF
        self.data = data
    
    def to_bytes(self, use_format_2: bool = False) -> bytes:
        """Serialize the message to KWP2000 frame bytes."""
        payload = bytes([self.service]) + self.data
        total_len = len(payload)
        
        if total_len < 64 and not use_format_2:
            # Format 1: short frame
            msg = bytes([total_len, self.target, self.source]) + payload
        else:
            # Format 2: long frame with extended length
            if total_len < 256:
                msg = bytes([0x80, self.target, self.source, total_len]) + payload
            else:
                msg = bytes([0x80, self.target, self.source, 0x00, 
                            (total_len >> 8) & 0xFF, total_len & 0xFF]) + payload
        
        # Add checksum (XOR of all bytes except checksum itself, then XOR with 0xFF)
        checksum = 0x00
        for b in msg:
            checksum ^= b
        msg += bytes([checksum])
        return msg
    
    @classmethod
    def from_bytes(cls, raw: bytes) -> Optional["KWPMessage"]:
        """Parse a KWP2000 message from raw bytes."""
        if len(raw) < 4:
            return None
        
        idx = 0
        if raw[0] == 0x80:
            # Format 2 or 3
            if len(raw) < 5:
                return None
            target = raw[1]
            source = raw[2]
            if raw[3] == 0x00:
                # Format 3: extended length
                if len(raw) < 7:
                    return None
                length = (raw[4] << 8) | raw[5]
                idx = 6
            else:
                length = raw[3]
                idx = 4
        else:
            # Format 1
            length = raw[0]
            target = raw[1]
            source = raw[2]
            idx = 3
        
        # Verify length (excluding checksum)
        expected = idx + length + 1  # +1 for checksum
        if len(raw) != expected:
            logger.warning(f"KWP message length mismatch: got {len(raw)}, expected {expected}")
            # Try to be lenient
        
        # Check checksum
        payload_and_header = raw[:-1]
        checksum = 0x00
        for b in payload_and_header:
            checksum ^= b
        if checksum != raw[-1]:
            logger.warning(f"KWP checksum mismatch: calc={checksum:02X}, got={raw[-1]:02X}")
        
        if length > 0 and idx + length <= len(raw):
            service = raw[idx]
            data = raw[idx + 1:idx + length]
        else:
            service = 0
            data = b""
        
        return cls(target=target, source=source, service=service, data=data)
    
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
    def negative_code(self) -> Optional[int]:
        if self.is_negative_response and len(self.data) >= 1:
            return self.data[0]
        return None
    
    def __repr__(self) -> str:
        return f"KWPMessage(target=0x{self.target:02X}, source=0x{self.source:02X}, service=0x{self.service:02X}, data={self.data.hex()})"


class KWP2000Protocol:
    """KWP2000 protocol handler for BMW diagnostics."""
    
    def __init__(self, interface, tester_addr: int = 0xF1, timeout_ms: int = P2_DEFAULT_TIMEOUT):
        self.interface = interface
        self.tester_addr = tester_addr
        self.timeout_ms = timeout_ms
        self.current_session = SessionType.DEFAULT
        self.current_ecu: Optional[int] = None
    
    def _send_and_receive(self, ecu: int, service: int, data: bytes = b"",
                          timeout_override: Optional[int] = None) -> Optional[KWPMessage]:
        """Send a KWP message and wait for response."""
        msg = KWPMessage(target=ecu, source=self.tester_addr, service=service, data=data)
        raw = msg.to_bytes()
        
        logger.debug(f"KWP TX -> {raw.hex()}")
        self.interface.write(raw)
        
        timeout = timeout_override or self.timeout_ms
        deadline = time.time() + (timeout / 1000.0)
        
        response_buffer = bytearray()
        while time.time() < deadline:
            chunk = self.interface.read(1)
            if chunk:
                response_buffer.extend(chunk)
                # Try to parse if we have enough data
                # KWP frame length is at byte 0 (unless 0x80 format)
                if len(response_buffer) >= 4:
                    # Check if we have a complete frame
                    if response_buffer[0] == 0x80:
                        if len(response_buffer) >= 5:
                            if response_buffer[3] == 0x00:
                                if len(response_buffer) >= 7:
                                    length = (response_buffer[4] << 8) | response_buffer[5]
                                    expected = 6 + length + 1
                                    if len(response_buffer) >= expected:
                                        break
                            else:
                                length = response_buffer[3]
                                expected = 4 + length + 1
                                if len(response_buffer) >= expected:
                                    break
                    else:
                        length = response_buffer[0]
                        expected = 3 + length + 1
                        if len(response_buffer) >= expected:
                            break
            else:
                time.sleep(0.001)
        
        if len(response_buffer) < 4:
            logger.warning(f"KWP: No response from ECU 0x{ecu:02X}")
            return None
        
        logger.debug(f"KWP RX <- {bytes(response_buffer).hex()}")
        return KWPMessage.from_bytes(bytes(response_buffer))
    
    # ── High-level KWP2000 services ─────────────────────────────────────
    
    def start_session(self, ecu: int, session_type: SessionType = SessionType.DEFAULT) -> bool:
        """Start a diagnostic session with the specified ECU."""
        self.current_ecu = ecu
        resp = self._send_and_receive(ecu, KWPServiceID.START_DIAGNOSTIC_SESSION, 
                                       bytes([session_type.value]))
        if resp and resp.is_positive_response:
            self.current_session = session_type
            logger.info(f"Started KWP session 0x{session_type.value:02X} with ECU 0x{ecu:02X}")
            return True
        elif resp and resp.is_negative_response:
            logger.warning(f"Negative response: 0x{resp.negative_code:02X}")
        return False
    
    def stop_session(self, ecu: int) -> bool:
        """Stop the diagnostic session."""
        resp = self._send_and_receive(ecu, KWPServiceID.STOP_DIAGNOSTIC_SESSION)
        self.current_ecu = None
        self.current_session = SessionType.DEFAULT
        return resp is not None and resp.is_positive_response
    
    def read_dtc(self, ecu: int) -> List[Tuple[int, int]]:
        """Read diagnostic trouble codes. Returns list of (DTC, status) tuples."""
        resp = self._send_and_receive(ecu, KWPServiceID.READ_DIAGNOSTIC_TROUBLE_CODES)
        if not resp or not resp.is_positive_response:
            return []
        
        dtcs = []
        # KWP2000 DTC format: 2 bytes per DTC (P/B/C/U + 4 hex digits), 1 byte status
        for i in range(0, len(resp.data), 3):
            if i + 2 < len(resp.data):
                dtc = (resp.data[i] << 8) | resp.data[i + 1]
                status = resp.data[i + 2]
                dtcs.append((dtc, status))
        return dtcs
    
    def read_dtc_by_status(self, ecu: int, status_mask: int = 0xFF) -> List[Tuple[int, int]]:
        """Read DTCs filtered by status."""
        resp = self._send_and_receive(ecu, KWPServiceID.READ_DIAGNOSTIC_TROUBLE_CODES_BY_STATUS,
                                       bytes([status_mask]))
        if not resp or not resp.is_positive_response:
            return []
        
        dtcs = []
        for i in range(0, len(resp.data), 3):
            if i + 2 < len(resp.data):
                dtc = (resp.data[i] << 8) | resp.data[i + 1]
                status = resp.data[i + 2]
                dtcs.append((dtc, status))
        return dtcs
    
    def clear_dtc(self, ecu: int) -> bool:
        """Clear all diagnostic trouble codes and freeze frame data."""
        resp = self._send_and_receive(ecu, KWPServiceID.CLEAR_DIAGNOSTIC_INFORMATION)
        return resp is not None and resp.is_positive_response
    
    def read_ecu_identification(self, ecu: int, id_type: int) -> Optional[bytes]:
        """Read ECU identification by type."""
        resp = self._send_and_receive(ecu, KWPServiceID.READ_ECU_IDENTIFICATION, bytes([id_type]))
        if resp and resp.is_positive_response:
            return resp.data[1:] if len(resp.data) > 1 else resp.data
        return None
    
    def read_vin(self, ecu: int) -> Optional[str]:
        """Read VIN from the ECU."""
        data = self.read_ecu_identification(ecu, KWPServiceID.READ_VIN)
        if data:
            return data.decode('ascii', errors='ignore').strip()
        return None
    
    def read_data_local(self, ecu: int, record_id: int) -> Optional[bytes]:
        """Read data by local identifier."""
        resp = self._send_and_receive(ecu, KWPServiceID.READ_DATA_BY_LOCAL_ID, bytes([record_id]))
        if resp and resp.is_positive_response:
            return resp.data[1:] if len(resp.data) > 1 else resp.data
        return None
    
    def security_access_request_seed(self, ecu: int, level: int) -> Optional[bytes]:
        """Request security seed."""
        resp = self._send_and_receive(ecu, KWPServiceID.SECURITY_ACCESS, bytes([level]))
        if resp and resp.is_positive_response and len(resp.data) >= 1:
            return resp.data[1:] if len(resp.data) > 1 else resp.data
        return None
    
    def security_access_send_key(self, ecu: int, level: int, key: bytes) -> bool:
        """Send security key."""
        resp = self._send_and_receive(ecu, KWPServiceID.SECURITY_ACCESS,
                                       bytes([level]) + key)
        return resp is not None and resp.is_positive_response
    
    def tester_present(self, ecu: int) -> bool:
        """Send tester present to keep session alive."""
        resp = self._send_and_receive(ecu, KWPServiceID.TESTER_PRESENT)
        return resp is not None
    
    def ecu_reset(self, ecu: int, reset_type: int = 0x01) -> bool:
        """Reset ECU."""
        resp = self._send_and_receive(ecu, KWPServiceID.ECU_RESET, bytes([reset_type]))
        return resp is not None and resp.is_positive_response
