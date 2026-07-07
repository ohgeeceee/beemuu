"""BMW K+DCAN Diagnostic Tool - FTDI / K+DCAN Interface Layer"""

import struct
import time
from typing import Optional, List, Tuple, Callable
from dataclasses import dataclass

import serial

from bmw_diag.core.constants import (
    FTDI_VID, FTDI_PID_KDCAN, FTDI_PID_BMW,
    DEFAULT_BAUDRATE, KLINE_BAUDRATE, CAN_BAUDRATE_500K,
    CBUS_KLINE_ENABLE, CBUS_CAN_ENABLE
)
from bmw_diag.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class CANFrame:
    """Represents a CAN 2.0 frame."""
    id: int
    data: bytes
    extended: bool = False
    dlc: int = 8
    
    def __post_init__(self):
        if len(self.data) > 8:
            raise ValueError("CAN data cannot exceed 8 bytes")
        self.dlc = len(self.data)


class BaseInterface:
    """Abstract base class for diagnostic interfaces."""
    
    def open(self) -> bool:
        raise NotImplementedError
    
    def close(self) -> None:
        raise NotImplementedError
    
    def is_open(self) -> bool:
        raise NotImplementedError
    
    def write(self, data: bytes) -> int:
        raise NotImplementedError
    
    def read(self, count: int, timeout_ms: int = 1000) -> bytes:
        raise NotImplementedError


class KLineInterface(BaseInterface):
    """K-line interface via FTDI serial port."""
    
    def __init__(self, port: str, baudrate: int = KLINE_BAUDRATE):
        self.port = port
        self.baudrate = baudrate
        self.serial: Optional[serial.Serial] = None
        self._buffer = bytearray()
    
    def open(self) -> bool:
        try:
            self.serial = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=0.05,
                write_timeout=1.0
            )
            # For K-line, we need CBUS control to select K-line vs CAN
            # Some cables use DTR/RTS for this
            self.serial.dtr = True
            self.serial.rts = False
            time.sleep(0.1)
            logger.info(f"K-line interface opened on {self.port} @ {self.baudrate} baud")
            return True
        except serial.SerialException as e:
            logger.error(f"Failed to open K-line interface: {e}")
            return False
    
    def close(self) -> None:
        if self.serial and self.serial.is_open:
            self.serial.close()
            self.serial = None
    
    def is_open(self) -> bool:
        return self.serial is not None and self.serial.is_open
    
    def write(self, data: bytes) -> int:
        if not self.is_open():
            return 0
        return self.serial.write(data)
    
    def read(self, count: int, timeout_ms: int = 1000) -> bytes:
        if not self.is_open():
            return b""
        
        deadline = time.time() + (timeout_ms / 1000.0)
        result = bytearray()
        
        while time.time() < deadline and len(result) < count:
            chunk = self.serial.read(min(count - len(result), 256))
            if chunk:
                result.extend(chunk)
            else:
                time.sleep(0.001)
        
        return bytes(result)
    
    def set_baudrate(self, baudrate: int) -> None:
        """Change baudrate dynamically."""
        if self.is_open():
            self.serial.baudrate = baudrate
            self.baudrate = baudrate
    
    def set_dtr(self, state: bool) -> None:
        """Set DTR line (used for K-line/CAN switching on some cables)."""
        if self.serial:
            self.serial.dtr = state
    
    def set_rts(self, state: bool) -> None:
        """Set RTS line."""
        if self.serial:
            self.serial.rts = state
    
    def kwp_5baud_init(self, ecu_addr: int) -> Optional[bytes]:
        """Perform KWP2000 5-baud init sequence.
        
        Returns the keyword bytes (0x01, 0x8A) or None if init failed.
        """
        if not self.is_open():
            return None
        
        # Set line to 5 baud for init
        self.set_baudrate(5)
        
        # Send 0x00 (start bit) + 8 data bits (LSB first) + stop bit at 5 baud
        # Actually we just need to send the address byte at 5 baud
        # But pyserial can't reliably do 5 baud. Instead, we bit-bang:
        
        # Better approach: send raw bytes using the timing
        # 5 baud = 200ms per bit
        # For address byte: start bit (0), data bits (LSB first), stop bit (1)
        
        addr_byte = ecu_addr & 0xFF
        bits = [0]  # start bit
        for i in range(8):
            bits.append((addr_byte >> i) & 1)
        bits.append(1)  # stop bit
        
        # Send bit-banged data
        for bit in bits:
            if bit:
                self.serial.dtr = True  # TX high
                self.serial.rts = True
            else:
                self.serial.dtr = False  # TX low
                self.serial.rts = False
            time.sleep(0.20)  # 200ms per bit at 5 baud
        
        # Return to normal baud rate
        self.set_baudrate(KLINE_BAUDRATE)
        
        # Read keyword bytes from ECU
        # ECU responds with: 0x55 (sync), 0x01, 0x8A, KB1, KB2
        time.sleep(0.1)
        keyword = self.read(5, timeout_ms=2000)
        if len(keyword) >= 3 and keyword[0] == 0x55:
            logger.info(f"KWP init successful: {keyword.hex()}")
            return keyword[:3]
        
        logger.warning(f"KWP init failed or wrong response: {keyword.hex()}")
        return None
    
    def send_fast_init(self, ecu_addr: int) -> Optional[bytes]:
        """Fast init for KWP2000 (used on some E46+ modules).
        
        Fast init: 50ms low, 25ms high, then send address at 10400 baud.
        """
        if not self.is_open():
            return None
        
        # Set 10400 baud for fast init
        self.set_baudrate(10400)
        
        # Pull line low for 50ms, high for 25ms
        self.serial.dtr = False
        time.sleep(0.050)
        self.serial.dtr = True
        time.sleep(0.025)
        
        # Send address byte
        self.write(bytes([ecu_addr]))
        time.sleep(0.01)
        
        # Read response
        resp = self.read(5, timeout_ms=2000)
        if len(resp) >= 3 and resp[0] == 0x55:
            return resp[:3]
        return None


class CANInterface(BaseInterface):
    """CAN interface via FTDI-based K+DCAN cable (using CAN over USB/serial).
    
    Many K+DCAN cables use a serial protocol to communicate CAN frames.
    Common protocols: LAWICEL/CAN232 (ASCII), or binary SLCan.
    Some cables use a proprietary binary protocol.
    
    This implementation assumes LAWICEL CAN232 format as it's widely used
    in cheap K+DCAN cables that use a second FT232 chip or CAN controller.
    """
    
    def __init__(self, port: str, baudrate: int = CAN_BAUDRATE_500K):
        self.port = port
        self.can_baudrate = baudrate
        self.serial: Optional[serial.Serial] = None
        self._initialized = False
    
    def open(self) -> bool:
        try:
            self.serial = serial.Serial(
                port=self.port,
                baudrate=DEFAULT_BAUDRATE,  # Command interface is at 115200
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=0.05,
                write_timeout=1.0
            )
            
            # Reset and initialize CAN controller
            self.serial.write(b"C\r")  # Close CAN
            time.sleep(0.1)
            self.serial.write(b"\r\r\r")
            time.sleep(0.1)
            
            # Set baud rate
            # LAWICEL: S0=10K, S1=20K, S2=50K, S3=100K, S4=125K, S5=250K, S6=500K, S7=800K, S8=1M
            baud_map = {
                10000: b"S0\r",
                20000: b"S1\r",
                50000: b"S2\r",
                100000: b"S3\r",
                125000: b"S4\r",
                250000: b"S5\r",
                500000: b"S6\r",
                800000: b"S7\r",
                1000000: b"S8\r",
            }
            
            if self.can_baudrate in baud_map:
                self.serial.write(baud_map[self.can_baudrate])
            else:
                # Default to 500K
                self.serial.write(b"S6\r")
            
            time.sleep(0.1)
            self.serial.write(b"O\r")  # Open CAN
            time.sleep(0.1)
            self.serial.reset_input_buffer()
            self._initialized = True
            
            logger.info(f"CAN interface opened on {self.port} @ {self.can_baudrate} baud")
            return True
        except serial.SerialException as e:
            logger.error(f"Failed to open CAN interface: {e}")
            return False
    
    def close(self) -> None:
        if self.serial and self.serial.is_open:
            self.serial.write(b"C\r")
            time.sleep(0.1)
            self.serial.close()
            self.serial = None
        self._initialized = False
    
    def is_open(self) -> bool:
        return self.serial is not None and self.serial.is_open and self._initialized
    
    def write(self, data: bytes) -> int:
        if not self.is_open():
            return 0
        return self.serial.write(data)
    
    def read(self, count: int, timeout_ms: int = 1000) -> bytes:
        if not self.is_open():
            return b""
        
        deadline = time.time() + (timeout_ms / 1000.0)
        result = bytearray()
        
        while time.time() < deadline and len(result) < count:
            chunk = self.serial.read(min(count - len(result), 256))
            if chunk:
                result.extend(chunk)
            else:
                time.sleep(0.001)
        
        return bytes(result)
    
    def send(self, can_id: int, data: bytes, extended: bool = False) -> bool:
        """Send a CAN frame."""
        if not self.is_open():
            return False
        
        dlc = min(len(data), 8)
        data_hex = data[:dlc].hex().upper()
        
        if extended:
            cmd = f"T{can_id:08X}{dlc}{data_hex}\r"
        else:
            cmd = f"t{can_id:03X}{dlc}{data_hex}\r"
        
        self.serial.write(cmd.encode())
        return True
    
    def receive(self, expected_id: Optional[int] = None, timeout_ms: int = 1000) -> Optional[bytes]:
        """Receive a CAN frame. Returns the 8-byte data or None."""
        if not self.is_open():
            return None
        
        deadline = time.time() + (timeout_ms / 1000.0)
        
        while time.time() < deadline:
            line = self.serial.readline()
            if line:
                line = line.strip().decode('ascii', errors='ignore')
                if line.startswith('t') or line.startswith('T'):
                    # LAWICEL format: t<id><dlc><data>
                    # e.g., t12380123456789ABCDEF
                    try:
                        if line.startswith('t'):
                            can_id = int(line[1:4], 16)
                            dlc = int(line[4], 16)
                            data_hex = line[5:5 + dlc * 2]
                            data = bytes.fromhex(data_hex)
                            
                            if expected_id is None or can_id == expected_id:
                                return data[:dlc]
                        elif line.startswith('T'):
                            can_id = int(line[1:9], 16)
                            dlc = int(line[9], 16)
                            data_hex = line[10:10 + dlc * 2]
                            data = bytes.fromhex(data_hex)
                            
                            if expected_id is None or can_id == expected_id:
                                return data[:dlc]
                    except ValueError:
                        pass
            else:
                time.sleep(0.001)
        
        return None


class KDCANInterface:
    """K+DCAN cable interface that handles both K-line and CAN.
    
    K+DCAN cables typically use FT232RL with CBUS pins to switch between:
    - K-line (for older BMW E30/E36/E46/E39)
    - CAN bus (for newer BMW E87/E90/F-series)
    
    The cable exposes two COM ports or uses DTR/RTS to switch.
    """
    
    def __init__(self, port: str, mode: str = "auto"):
        self.port = port
        self.mode = mode
        self.kline: Optional[KLineInterface] = None
        self.can: Optional[CANInterface] = None
        self._active_interface: Optional[BaseInterface] = None
    
    def open(self, preferred_mode: Optional[str] = None) -> bool:
        """Open the K+DCAN interface."""
        mode = preferred_mode or self.mode
        
        if mode in ("kline", "auto"):
            # Try K-line first for older vehicles
            self.kline = KLineInterface(self.port)
            if self.kline.open():
                self._active_interface = self.kline
                self.mode = "kline"
                logger.info("K+DCAN interface opened in K-line mode")
                return True
        
        if mode in ("can", "auto"):
            # Try CAN mode
            self.can = CANInterface(self.port)
            if self.can.open():
                self._active_interface = self.can
                self.mode = "can"
                logger.info("K+DCAN interface opened in CAN mode")
                return True
        
        logger.error("Failed to open K+DCAN interface in any mode")
        return False
    
    def close(self) -> None:
        if self.kline:
            self.kline.close()
        if self.can:
            self.can.close()
        self._active_interface = None
    
    def is_open(self) -> bool:
        return self._active_interface is not None and self._active_interface.is_open()
    
    def write(self, data: bytes) -> int:
        if self._active_interface:
            return self._active_interface.write(data)
        return 0
    
    def read(self, count: int, timeout_ms: int = 1000) -> bytes:
        if self._active_interface:
            return self._active_interface.read(count, timeout_ms)
        return b""
    
    def get_kline(self) -> Optional[KLineInterface]:
        return self.kline
    
    def get_can(self) -> Optional[CANInterface]:
        return self.can
    
    @property
    def active_mode(self) -> str:
        return self.mode if self._active_interface else "closed"
    
    def switch_mode(self, mode: str) -> bool:
        """Switch between K-line and CAN modes."""
        if mode == self.mode and self.is_open():
            return True
        
        self.close()
        return self.open(preferred_mode=mode)
