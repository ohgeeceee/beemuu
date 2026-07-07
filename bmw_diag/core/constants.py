"""BMW K+DCAN Diagnostic Constants

Real constants for BMW diagnostic communication via K+DCAN cable (FTDI FT232RL).
"""

from enum import IntEnum, unique

# ── FTDI / Hardware Constants ──────────────────────────────────────────

FTDI_VID = 0x0403
FTDI_PID_KDCAN = 0x6001   # Common FT232RL PID
FTDI_PID_BMW = 0xFA33     # Some BMW-branded cables use this

# CBUS pin mapping on FT232RL for K+DCAN multiplexing
# CBUS3 typically controls K-line vs CAN bus switching
CBUS_KLINE_ENABLE = 0x01
CBUS_CAN_ENABLE = 0x00

# Default serial settings
DEFAULT_BAUDRATE = 115200
KLINE_BAUDRATE = 9600
KLINE_BAUDRATE_FAST = 10400
DS2_BAUDRATE = 9600

# ── ECU Addresses (KWP2000 / DS2) ───────────────────────────────────────

@unique
class ECUAddress(IntEnum):
    """BMW ECU addresses for diagnostic communication."""
    # Engine / Drivetrain
    DME = 0x12          # Digital Motor Electronics (Engine)
    EGS = 0x32          # Electronic Gearbox Control
    ACS = 0x56          # Automatic Stability Control (ABS/DSC)
    MRS = 0x72          # Multiple Restraint System (Airbags)
    
    # Body / Chassis
    GM = 0x40           # General Module (Body electronics)
    ZKE = 0x46          # Central Body Electronics
    IKE = 0x60          # Instrument Cluster (Kombi)
    EWS = 0x44          # Anti-theft (EWS)
    
    # Comfort / Interior
    KBM = 0x42          # Control Module Body (Wipers, etc.)
    SHD = 0x73          # Sunroof (Schiebedach)
    SHZ = 0x4A          # Seat Heating
    PDC = 0x66          # Park Distance Control
    
    # Audio / Nav / Entertainment
    MID = 0x43          # Multi-Information Display (E46)
    RAD = 0x68          # Radio
    NAV = 0x3B          # Navigation
    DSP = 0x6A          # Digital Sound Processor
    CDC = 0x18          # CD Changer
    TV = 0x47           # TV Module
    
    # Climate / HVAC
    IHKA = 0x50         # Integrated Heating & Air Conditioning
    EHC = 0x61          # Electronic Height Control (E38/E39)
    
    # E-series specific
    CAS = 0x00          # Car Access System (CAS1-4)
    FRM = 0x00          # Footwell Module (E-series, address via UDS)
    JBE = 0x00          # Junction Box Electronics (E-series)
    
    # F-series / G-series UDS gateways (mapped by ECU name in UDS)
    BDC = 0x00          # Body Domain Controller
    DME_UDS = 0x00      # UDS DME (identified by response)
    EGS_UDS = 0x00      # UDS EGS (identified by response)


# ECU name mapping for display
ECU_NAMES = {
    ECUAddress.DME: "DME - Digital Motor Electronics",
    ECUAddress.EGS: "EGS - Electronic Gearbox Control",
    ECUAddress.ACS: "ABS/DSC - Stability Control",
    ECUAddress.MRS: "MRS - Airbag System",
    ECUAddress.GM: "GM - General Module",
    ECUAddress.ZKE: "ZKE - Central Body Electronics",
    ECUAddress.IKE: "IKE - Instrument Cluster",
    ECUAddress.EWS: "EWS - Anti-theft",
    ECUAddress.KBM: "KBM - Body Control",
    ECUAddress.SHD: "SHD - Sunroof",
    ECUAddress.SHZ: "SHZ - Seat Heating",
    ECUAddress.PDC: "PDC - Park Distance Control",
    ECUAddress.MID: "MID - Display",
    ECUAddress.RAD: "RAD - Radio",
    ECUAddress.NAV: "NAV - Navigation",
    ECUAddress.DSP: "DSP - Sound Processor",
    ECUAddress.CDC: "CDC - CD Changer",
    ECUAddress.TV: "TV - TV Module",
    ECUAddress.IHKA: "IHKA - Climate Control",
    ECUAddress.EHC: "EHC - Height Control",
}


# ── KWP2000 (Keyword Protocol 2000) Service IDs ───────────────────────

@unique
class KWPServiceID(IntEnum):
    """KWP2000 service identifiers for BMW (pre-UDS)."""
    START_DIAGNOSTIC_SESSION = 0x10
    ECU_RESET = 0x11
    READ_FREEZEFRAME_DATA = 0x12
    READ_DIAGNOSTIC_TROUBLE_CODES = 0x13
    CLEAR_DIAGNOSTIC_INFORMATION = 0x14
    READ_STATUS_OF_DTC = 0x17
    READ_DIAGNOSTIC_TROUBLE_CODES_BY_STATUS = 0x18
    READ_ECU_IDENTIFICATION = 0x1A
    STOP_DIAGNOSTIC_SESSION = 0x20
    READ_DATA_BY_LOCAL_ID = 0x21
    READ_DATA_BY_COMMON_ID = 0x22
    READ_MEMORY_BY_ADDRESS = 0x23
    SET_DATA_RATE = 0x26
    SECURITY_ACCESS = 0x27
    DISABLE_NORMAL_MESSAGE_TRANSMISSION = 0x28
    ENABLE_NORMAL_MESSAGE_TRANSMISSION = 0x29
    DYNAMICALLY_DEFINE_LOCAL_ID = 0x2C
    WRITE_DATA_BY_LOCAL_ID = 0x2E
    WRITE_MEMORY_BY_ADDRESS = 0x3D
    TESTER_PRESENT = 0x3E
    ESCAPE_CODE = 0x80
    
    # Common BMW-specific sub-functions
    READ_VIN = 0x90
    READ_HW_NUMBER = 0x91
    READ_SW_NUMBER = 0x92
    READ_CODING_INDEX = 0x94
    READ_DIAG_INDEX = 0x95
    READ_BUS_INDEX = 0x96
    READ_MANUFACTURING_DATE = 0x97
    READ_SUPPLIER_HW_NUMBER = 0x98
    READ_SUPPLIER_SW_NUMBER = 0x99
    READ_OTP = 0x9A
    READ_FA = 0x9B          # Order configuration (FA/VO)
    READ_ZCS = 0x9C         # Vehicle order (ZCS)
    READ_FP = 0xA0          # Fahrzeug-Programm (Programming Data)
    
    # Positive response offset
    RESPONSE_OFFSET = 0x40


# ── UDS (ISO 14229) Service IDs ───────────────────────────────────────

@unique
class UDSServiceID(IntEnum):
    """UDS service identifiers for BMW (F-series and newer)."""
    DIAGNOSTIC_SESSION_CONTROL = 0x10
    ECU_RESET = 0x11
    CLEAR_DIAGNOSTIC_INFORMATION = 0x14
    READ_DTC_INFORMATION = 0x19
    READ_DATA_BY_IDENTIFIER = 0x22
    READ_MEMORY_BY_ADDRESS = 0x23
    READ_SCALING_DATA_BY_IDENTIFIER = 0x24
    SECURITY_ACCESS = 0x27
    COMMUNICATION_CONTROL = 0x28
    READ_DATA_BY_PERIODIC_IDENTIFIER = 0x2A
    DYNAMICALLY_DEFINE_DATA_IDENTIFIER = 0x2C
    WRITE_DATA_BY_IDENTIFIER = 0x2E
    INPUT_OUTPUT_CONTROL_BY_IDENTIFIER = 0x2F
    ROUTINE_CONTROL = 0x31
    REQUEST_DOWNLOAD = 0x34
    REQUEST_UPLOAD = 0x35
    TRANSFER_DATA = 0x36
    REQUEST_TRANSFER_EXIT = 0x37
    WRITE_MEMORY_BY_ADDRESS = 0x3D
    TESTER_PRESENT = 0x3E
    CONTROL_DTC_SETTING = 0x85
    
    RESPONSE_OFFSET = 0x40


# ── UDS Data Identifiers (DIDs) ───────────────────────────────────────

@unique
class UDSDataIdentifier(IntEnum):
    """Common UDS Data Identifiers for BMW."""
    VIN = 0xF190
    ECU_SERIAL_NUMBER = 0xF18C
    ECU_HARDWARE_VERSION = 0xF193
    ECU_SOFTWARE_VERSION = 0xF194
    SYSTEM_SUPPLIER_CODE = 0xF19A
    ECU_MANUFACTURING_DATE = 0xF19B
    ECU_DIAGNOSTIC_IDENTIFICATION = 0xF19C
    ECU_PROGRAMMING_DATE = 0xF199
    VEHICLE_MANUFACTURER_ECU_HW_NUMBER = 0xF1A0
    VEHICLE_MANUFACTURER_ECU_SW_NUMBER = 0xF1A1
    
    # BMW-specific
    VEHICLE_ORDER = 0x0601
    FA = 0x0600
    NETTODATA = 0x0602
    TRACES = 0x0603
    ECU_CLUSTER = 0x0604
    VIN_CURRENT = 0x0605
    PROGRAMMING_DATA = 0x0606


# ── Diagnostic Session Types ────────────────────────────────────────────

@unique
class SessionType(IntEnum):
    """Diagnostic session types for KWP2000 and UDS."""
    DEFAULT = 0x01
    PROGRAMMING = 0x02
    EXTENDED_DIAGNOSTIC = 0x03
    DEVELOPER = 0x04
    TRANSPORT = 0x05
    # BMW-specific
    KWP2000_DEFAULT = 0x81
    KWP2000_PROGRAMMING = 0x85
    KWP2000_DEVELOPER = 0x86
    KWP2000_FAST = 0x89


# ── Negative Response Codes ─────────────────────────────────────────────

@unique
class NegativeResponseCode(IntEnum):
    """Negative response codes (ISO 14229 / KWP2000)."""
    GENERAL_REJECT = 0x10
    SERVICE_NOT_SUPPORTED = 0x11
    SUB_FUNCTION_NOT_SUPPORTED = 0x12
    INCORRECT_MESSAGE_LENGTH = 0x13
    CONDITIONS_NOT_CORRECT = 0x22
    REQUEST_SEQUENCE_ERROR = 0x24
    REQUEST_OUT_OF_RANGE = 0x31
    SECURITY_ACCESS_DENIED = 0x33
    INVALID_KEY = 0x35
    EXCEED_NUMBER_OF_ATTEMPTS = 0x36
    REQUIRED_TIME_DELAY_NOT_EXPIRED = 0x37
    UPLOAD_DOWNLOAD_NOT_ACCEPTED = 0x70
    TRANSFER_DATA_SUSPENDED = 0x71
    GENERAL_PROGRAMMING_FAILURE = 0x72
    WRONG_BLOCK_SEQUENCE_COUNTER = 0x73
    RESPONSE_TOO_LONG = 0x78
    SUB_FUNCTION_NOT_SUPPORTED_IN_ACTIVE_SESSION = 0x7E
    SERVICE_NOT_SUPPORTED_IN_ACTIVE_SESSION = 0x7F
    RPM_TOO_HIGH = 0x81
    RPM_TOO_LOW = 0x82
    ENGINE_IS_RUNNING = 0x83
    ENGINE_IS_NOT_RUNNING = 0x84
    SHIFTER_LEVER_NOT_IN_PARK = 0x90
    # BMW-specific
    KWP2000_ILLEGAL_FORMAT = 0x21
    KWP2000_BUSY = 0xB1


# ── DTC Status Byte Masks ─────────────────────────────────────────────

DTC_STATUS_TEST_FAILED = 0x01
DTC_STATUS_TEST_FAILED_THIS_OPERATION_CYCLE = 0x02
DTC_STATUS_PENDING = 0x04
DTC_STATUS_CONFIRMED = 0x08
DTC_STATUS_TEST_NOT_COMPLETED_SINCE_LAST_CLEAR = 0x10
DTC_STATUS_TEST_FAILED_SINCE_LAST_CLEAR = 0x20
DTC_STATUS_TEST_NOT_COMPLETED_THIS_OPERATION_CYCLE = 0x40
DTC_STATUS_WARNING_INDICATOR_REQUESTED = 0x80


# ── Timing Constants ────────────────────────────────────────────────────

P2_DEFAULT_TIMEOUT = 1000        # ms
P2_EXTENDED_TIMEOUT = 5000       # ms
P3_DEFAULT_TIMEOUT = 5000      # ms between requests
P4_MIN_INTERBYTE = 0             # ms

# KWP2000 timing (T1, T2, T3, T4, T5)
KWP_T1_MAX = 4000   # Inter-byte timeout (ms)
KWP_T2_MAX = 5000   # Response timeout (ms)
KWP_T3_MAX = 5000   # Idle time between messages (ms)
KWP_T4_MIN = 5      # Min inter-byte (ms)
KWP_T5_MAX = 5000   # Idle time after reset (ms)

# UDS timing (P2 / P2*)
UDS_P2_TIMEOUT = 50     # ms (default UDS P2 is shorter than KWP)
UDS_P2_STAR_TIMEOUT = 5000  # ms

# ── Protocol Types ─────────────────────────────────────────────────────

PROTOCOL_KWP2000 = "kwp2000"
PROTOCOL_DS2 = "ds2"
PROTOCOL_UDS = "uds"
PROTOCOL_CAN = "can"
PROTOCOL_KLINE = "kline"

# ── CAN Bus Constants ───────────────────────────────────────────────────

CAN_BAUDRATE_500K = 500000
CAN_BAUDRATE_100K = 100000
CAN_BAUDRATE_125K = 125000

# BMW CAN IDs for diagnostics (UDS on CAN)
# Physical request IDs: 0x6XX where XX = ECU address
# Physical response IDs: 0x7XX where XX = ECU address (or 0x58X for some)
# Functional request: 0x6DF (broadcast)
# Functional response: 0x7DF (not typically used for responses)

def can_request_id(ecu_addr: int) -> int:
    """Get CAN request ID for an ECU address."""
    return 0x600 + ecu_addr

def can_response_id(ecu_addr: int) -> int:
    """Get CAN response ID for an ECU address."""
    return 0x700 + ecu_addr

# ── K-Line / KWP2000 Bus Constants ────────────────────────────────────

KWP2000_INIT_5BAUD = "5baud"
KWP2000_INIT_FAST = "fast"

# BMW 5-baud init address sequence (E30/E36/E46/etc.)
# Format: 0x55, 0x01, 0x8A, KB1, KB2
# 0x55 = sync byte
# 0x01 = key byte 1
# 0x8A = key byte 2
# KB1/KB2 = inverted address bytes

# ── DS2 Protocol Constants ─────────────────────────────────────────────

DS2_SYNC_BYTE = 0xB8
DS2_INIT_ADDRESS = 0x11

# ── Security Access Seeds ─────────────────────────────────────────────

# Default BMW seed length
SEED_LENGTH_DEFAULT = 4
KEY_LENGTH_DEFAULT = 4

# Common BMW key derivation algorithms (simplified)
# Real algorithms are BMW-proprietary and ECU-specific
# For open-source tool, we document common approaches:
# - Some ECUs: key = seed ^ 0xDEADBEEF or similar
# - Others: key = rotate(seed) + constant
# - Real BMW coding requires custom algorithms per ECU

# ── Logging ────────────────────────────────────────────────────────────

LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
LOG_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
LOG_BACKUP_COUNT = 5

# ── Version ───────────────────────────────────────────────────────────

APP_NAME = "BMW K+DCAN Diagnostic Tool"
APP_VERSION = "1.0.0"
APP_AUTHOR = "Open Source Community"
APP_LICENSE = "MIT"
