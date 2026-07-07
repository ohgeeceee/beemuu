"""BMW K+DCAN Diagnostic Tool - DTC Parser and Database"""

from typing import Optional, List, Dict, Tuple
from dataclasses import dataclass

from bmw_diag.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class DTC:
    """Diagnostic Trouble Code record."""
    code: str            # Human-readable code (e.g., "P0301", "5F12")
    raw: int             # Raw integer value
    description: str     # Human description
    category: str        # "P"=Powertrain, "B"=Body, "C"=Chassis, "U"=Network, "BMW"=BMW-specific
    status: Optional[int] = None
    status_text: str = ""
    ecu: str = "Unknown"


class DTCParser:
    """Parse BMW DTCs from various ECU protocols."""
    
    # Standard OBD-II DTC category prefixes
    CATEGORIES = {
        0x00: "P",   # Powertrain
        0x01: "P",   # Powertrain
        0x02: "B",   # Body
        0x03: "C",   # Chassis
    }
    
    @classmethod
    def parse_kwp_dtc(cls, raw: int, ecu_name: str = "") -> DTC:
        """Parse a KWP2000-style 2-byte DTC.
        
        BMW KWP2000 DTCs are often BMW-specific and don't follow standard OBD-II
        exactly. Some are stored as raw hex like 0x5F12.
        """
        raw &= 0xFFFF
        
        # Check if it's a standard OBD-II DTC (BMW DME sometimes uses these)
        # First byte: category (bits 6-7) + first digit (bits 4-5) + second digit (bits 0-3)
        cat_bits = (raw >> 14) & 0x03
        first_digit = (raw >> 12) & 0x03
        second_digit = (raw >> 8) & 0x0F
        third_digit = (raw >> 4) & 0x0F
        fourth_digit = raw & 0x0F
        
        category = cls.CATEGORIES.get(cat_bits, "U")
        if cat_bits == 0x03:
            category = "U"
        
        code = f"{category}{first_digit}{second_digit:X}{third_digit:X}{fourth_digit:X}"
        
        # Get description from database
        desc = DTCDatabase.get_description(code, raw, ecu_name)
        
        return DTC(
            code=code,
            raw=raw,
            description=desc,
            category=category,
            ecu=ecu_name
        )
    
    @classmethod
    def parse_uds_dtc(cls, raw: int, ecu_name: str = "") -> DTC:
        """Parse a UDS 3-byte DTC (ISO 15031-6 / SAE J2012)."""
        raw &= 0xFFFFFF
        
        cat_bits = (raw >> 22) & 0x03
        first_digit = (raw >> 20) & 0x03
        second_digit = (raw >> 16) & 0x0F
        third_digit = (raw >> 12) & 0x0F
        fourth_digit = (raw >> 8) & 0x0F
        
        category = cls.CATEGORIES.get(cat_bits, "U")
        if cat_bits == 0x03:
            category = "U"
        
        code = f"{category}{first_digit}{second_digit:X}{third_digit:X}{fourth_digit:X}"
        
        desc = DTCDatabase.get_description(code, raw, ecu_name)
        
        return DTC(
            code=code,
            raw=raw,
            description=desc,
            category=category,
            ecu=ecu_name
        )
    
    @classmethod
    def parse_bmw_specific_dtc(cls, raw: int, ecu_name: str = "") -> DTC:
        """Parse BMW-specific DTC format (4 hex digits, often from non-engine modules)."""
        raw &= 0xFFFF
        code = f"0x{raw:04X}"
        
        desc = DTCDatabase.get_bmw_description(raw, ecu_name)
        
        return DTC(
            code=code,
            raw=raw,
            description=desc,
            category="BMW",
            ecu=ecu_name
        )
    
    @classmethod
    def parse_status_byte(cls, status: int) -> str:
        """Parse DTC status byte into human-readable text."""
        flags = []
        if status & 0x01:
            flags.append("TestFailed")
        if status & 0x02:
            flags.append("TestFailedThisCycle")
        if status & 0x04:
            flags.append("Pending")
        if status & 0x08:
            flags.append("Confirmed")
        if status & 0x10:
            flags.append("NotCompletedSinceClear")
        if status & 0x20:
            flags.append("FailedSinceClear")
        if status & 0x40:
            flags.append("NotCompletedThisCycle")
        if status & 0x80:
            flags.append("WarningLight")
        return ", ".join(flags) if flags else "NoStatus"
    
    @classmethod
    def parse_kwp_dtcs(cls, raw_dtcs: List[Tuple[int, int]], ecu_name: str = "") -> List[DTC]:
        """Parse list of (raw_dtc, status) tuples from KWP2000."""
        result = []
        for raw, status in raw_dtcs:
            dtc = cls.parse_kwp_dtc(raw, ecu_name)
            dtc.status = status
            dtc.status_text = cls.parse_status_byte(status)
            result.append(dtc)
        return result
    
    @classmethod
    def parse_uds_dtcs(cls, raw_dtcs: List[Dict], ecu_name: str = "") -> List[DTC]:
        """Parse list of UDS DTC dicts."""
        result = []
        for item in raw_dtcs:
            raw = item.get('dtc', 0)
            status = item.get('status', 0)
            dtc = cls.parse_uds_dtc(raw, ecu_name)
            dtc.status = status
            dtc.status_text = cls.parse_status_byte(status)
            result.append(dtc)
        return result


class DTCDatabase:
    """Database of common BMW and OBD-II DTC descriptions."""
    
    # Common OBD-II DTCs that BMW uses
    _COMMON_DTCS = {
        "P0000": "No DTC found / No malfunction",
        "P0001": "Fuel Volume Regulator Control Circuit/Open",
        "P0002": "Fuel Volume Regulator Control Circuit Range/Performance",
        "P0003": "Fuel Volume Regulator Control Circuit Low",
        "P0004": "Fuel Volume Regulator Control Circuit High",
        "P0010": "A Camshaft Position Actuator Circuit (Bank 1)",
        "P0011": "A Camshaft Position - Timing Over-Advanced or System Performance (Bank 1)",
        "P0012": "A Camshaft Position - Timing Over-Retarded (Bank 1)",
        "P0015": "B Camshaft Position - Timing Over-Retarded (Bank 1)",
        "P0020": "A Camshaft Position Actuator Circuit (Bank 2)",
        "P0025": "B Camshaft Position - Timing Over-Retarded (Bank 2)",
        "P0030": "HO2S Heater Control Circuit (Bank 1 Sensor 1)",
        "P0031": "HO2S Heater Control Circuit Low (Bank 1 Sensor 1)",
        "P0032": "HO2S Heater Control Circuit High (Bank 1 Sensor 1)",
        "P0036": "HO2S Heater Control Circuit (Bank 1 Sensor 2)",
        "P0100": "Mass or Volume Air Flow Circuit",
        "P0101": "Mass or Volume Air Flow Circuit Range/Performance",
        "P0102": "Mass or Volume Air Flow Circuit Low Input",
        "P0103": "Mass or Volume Air Flow Circuit High Input",
        "P0110": "Intake Air Temperature Circuit",
        "P0115": "Engine Coolant Temperature Circuit",
        "P0116": "Engine Coolant Temperature Circuit Range/Performance",
        "P0117": "Engine Coolant Temperature Circuit Low Input",
        "P0118": "Engine Coolant Temperature Circuit High Input",
        "P0120": "Throttle/Pedal Position Sensor/Switch A Circuit",
        "P0121": "Throttle/Pedal Position Sensor/Switch A Circuit Range/Performance",
        "P0122": "Throttle/Pedal Position Sensor/Switch A Circuit Low Input",
        "P0123": "Throttle/Pedal Position Sensor/Switch A Circuit High Input",
        "P0130": "O2 Sensor Circuit (Bank 1 Sensor 1)",
        "P0131": "O2 Sensor Circuit Low Voltage (Bank 1 Sensor 1)",
        "P0132": "O2 Sensor Circuit High Voltage (Bank 1 Sensor 1)",
        "P0133": "O2 Sensor Circuit Slow Response (Bank 1 Sensor 1)",
        "P0135": "O2 Sensor Heater Circuit (Bank 1 Sensor 1)",
        "P0140": "O2 Sensor Circuit (Bank 1 Sensor 2)",
        "P0141": "O2 Sensor Heater Circuit (Bank 1 Sensor 2)",
        "P0171": "System Too Lean (Bank 1)",
        "P0172": "System Too Rich (Bank 1)",
        "P0174": "System Too Lean (Bank 2)",
        "P0175": "System Too Rich (Bank 2)",
        "P0200": "Injector Circuit/Open",
        "P0201": "Injector Circuit/Open - Cylinder 1",
        "P0202": "Injector Circuit/Open - Cylinder 2",
        "P0203": "Injector Circuit/Open - Cylinder 3",
        "P0204": "Injector Circuit/Open - Cylinder 4",
        "P0205": "Injector Circuit/Open - Cylinder 5",
        "P0206": "Injector Circuit/Open - Cylinder 6",
        "P0217": "Engine Over Temperature Condition",
        "P0220": "Throttle/Pedal Position Sensor/Switch B Circuit",
        "P0222": "Throttle/Pedal Position Sensor/Switch B Circuit Low Input",
        "P0223": "Throttle/Pedal Position Sensor/Switch B Circuit High Input",
        "P0230": "Fuel Pump Primary Circuit",
        "P0243": "Turbocharger Wastegate Solenoid A Low",
        "P0244": "Turbocharger Wastegate Solenoid A Range/Performance",
        "P0245": "Turbocharger Wastegate Solenoid A Low",
        "P0246": "Turbocharger Wastegate Solenoid A High",
        "P0300": "Random/Multiple Cylinder Misfire Detected",
        "P0301": "Cylinder 1 Misfire Detected",
        "P0302": "Cylinder 2 Misfire Detected",
        "P0303": "Cylinder 3 Misfire Detected",
        "P0304": "Cylinder 4 Misfire Detected",
        "P0305": "Cylinder 5 Misfire Detected",
        "P0306": "Cylinder 6 Misfire Detected",
        "P0313": "Misfire Detected with Low Fuel",
        "P0325": "Knock Sensor 1 Circuit (Bank 1)",
        "P0326": "Knock Sensor 1 Circuit Range/Performance (Bank 1)",
        "P0335": "Crankshaft Position Sensor A Circuit",
        "P0336": "Crankshaft Position Sensor A Circuit Range/Performance",
        "P0340": "Camshaft Position Sensor A Circuit (Bank 1)",
        "P0341": "Camshaft Position Sensor A Circuit Range/Performance (Bank 1)",
        "P0342": "Camshaft Position Sensor A Circuit Low Input (Bank 1)",
        "P0343": "Camshaft Position Sensor A Circuit High Input (Bank 1)",
        "P0351": "Ignition Coil A Primary/Secondary Circuit",
        "P0352": "Ignition Coil B Primary/Secondary Circuit",
        "P0353": "Ignition Coil C Primary/Secondary Circuit",
        "P0354": "Ignition Coil D Primary/Secondary Circuit",
        "P0355": "Ignition Coil E Primary/Secondary Circuit",
        "P0356": "Ignition Coil F Primary/Secondary Circuit",
        "P0400": "Exhaust Gas Recirculation Flow",
        "P0401": "Exhaust Gas Recirculation Flow Insufficient Detected",
        "P0402": "Exhaust Gas Recirculation Flow Excessive Detected",
        "P0420": "Catalyst System Efficiency Below Threshold (Bank 1)",
        "P0430": "Catalyst System Efficiency Below Threshold (Bank 2)",
        "P0440": "Evaporative Emission System",
        "P0441": "Evaporative Emission System Incorrect Purge Flow",
        "P0442": "Evaporative Emission System Leak Detected (small leak)",
        "P0455": "Evaporative Emission System Leak Detected (large leak)",
        "P0460": "Fuel Level Sensor A Circuit",
        "P0462": "Fuel Level Sensor A Circuit Low Input",
        "P0463": "Fuel Level Sensor A Circuit High Input",
        "P0480": "Cooling Fan 1 Control Circuit",
        "P0500": "Vehicle Speed Sensor A",
        "P0501": "Vehicle Speed Sensor A Range/Performance",
        "P0505": "Idle Air Control System",
        "P0506": "Idle Air Control System RPM Lower Than Expected",
        "P0507": "Idle Air Control System RPM Higher Than Expected",
        "P0560": "System Voltage",
        "P0562": "System Voltage Low",
        "P0563": "System Voltage High",
        "P0600": "Serial Communication Link",
        "P0601": "Internal Control Module Memory Check Sum Error",
        "P0602": "Control Module Programming Error",
        "P0603": "Internal Control Module Keep Alive Memory (KAM) Error",
        "P0604": "Internal Control Module Random Access Memory (RAM) Error",
        "P0605": "Internal Control Module Read Only Memory (ROM) Error",
        "P0606": "ECM/PCM Processor",
        "P0700": "Transmission Control System (MIL Request)",
        "P0705": "Transmission Range Sensor Circuit (PRNDL Input)",
        "P0710": "Transmission Fluid Temperature Sensor A Circuit",
        "P0715": "Input/Turbine Speed Sensor A Circuit",
        "P0720": "Output Speed Sensor Circuit",
        "P0730": "Incorrect Gear Ratio",
        "P0731": "Gear 1 Incorrect Ratio",
        "P0732": "Gear 2 Incorrect Ratio",
        "P0733": "Gear 3 Incorrect Ratio",
        "P0734": "Gear 4 Incorrect Ratio",
        "P0735": "Gear 5 Incorrect Ratio",
        "P0740": "Torque Converter Clutch Circuit/Open",
        "P0741": "Torque Converter Clutch Circuit Performance or Stuck Off",
        "P0742": "Torque Converter Clutch Circuit Stuck On",
        "P0750": "Shift Solenoid A",
        "P0755": "Shift Solenoid B",
        "P0760": "Shift Solenoid C",
        "P0770": "Shift Solenoid E",
        "P0800": "Transfer Case Control System (MIL Request)",
        "P1000": "OBD-II Monitor Testing Not Complete (Ford-specific, sometimes BMW)",
        
        # Body codes (B-series)
        "B0001": "Driver Frontal Stage 1 Deployment Control",
        "B0004": "Driver Knee Bolster Deployment Control",
        "B0010": "Passenger Frontal Stage 1 Deployment Control",
        "B0020": "Left Side Airbag Deployment Control",
        "B0028": "Right Side Airbag Deployment Control",
        "B0050": "Driver Seatbelt Sensor",
        "B0053": "Passenger Seatbelt Sensor",
        
        # Chassis codes (C-series)
        "C0035": "Left Front Wheel Speed Sensor",
        "C0040": "Right Front Wheel Speed Sensor",
        "C0045": "Left Rear Wheel Speed Sensor",
        "C0050": "Right Rear Wheel Speed Sensor",
        "C0060": "Left Rear ABS Valve",
        "C0065": "Right Rear ABS Valve",
        "C0070": "Left Front ABS Valve",
        "C0075": "Right Front ABS Valve",
        "C0090": "Left Front Inlet ABS Valve",
        "C0095": "Left Front Outlet ABS Valve",
        
        # Network/Communication (U-series)
        "U0001": "High Speed CAN Communication Bus",
        "U0002": "High Speed CAN Communication Bus Performance",
        "U0100": "Lost Communication With ECM/PCM",
        "U0101": "Lost Communication With TCM",
        "U0102": "Lost Communication With Transfer Case Control Module",
        "U0121": "Lost Communication With ABS Control Module",
        "U0155": "Lost Communication With Instrument Panel Cluster (IPC) Control Module",
        "U0164": "Lost Communication With HVAC Control Module",
        "U0170": "Lost Communication With "Restraints Occupant Classification" System Module",
        "U0300": "Internal Control Module Software Incompatibility",
        "U0401": "Invalid Data Received From ECM/PCM",
        "U0402": "Invalid Data Received From TCM",
    }
    
    # BMW-specific descriptions by raw hex code (for non-OBD modules)
    _BMW_SPECIFIC = {
        # DME-specific codes (0x00-0xFF range in raw BMW format)
        0x0001: "DME: Misfire Cylinder 1",
        0x0002: "DME: Misfire Cylinder 2",
        0x0003: "DME: Misfire Cylinder 3",
        0x0004: "DME: Misfire Cylinder 4",
        0x0005: "DME: Misfire Cylinder 5",
        0x0006: "DME: Misfire Cylinder 6",
        0x0014: "DME: Camshaft Position Sensor Inlet",
        0x0015: "DME: Camshaft Position Sensor Exhaust",
        0x0016: "DME: Crankshaft Position Sensor",
        0x0017: "DME: Crankshaft Position Sensor Signal",
        0x0020: "DME: Fuel Pump Relay",
        0x0021: "DME: Fuel Pump",
        0x0029: "DME: Fuel Injector Cylinder 1",
        0x002A: "DME: Fuel Injector Cylinder 2",
        0x002B: "DME: Fuel Injector Cylinder 3",
        0x002C: "DME: Fuel Injector Cylinder 4",
        0x002D: "DME: Fuel Injector Cylinder 5",
        0x002E: "DME: Fuel Injector Cylinder 6",
        0x0030: "DME: Oxygen Sensor Bank 1 Before Catalytic Converter",
        0x0031: "DME: Oxygen Sensor Bank 1 After Catalytic Converter",
        0x0032: "DME: Oxygen Sensor Bank 2 Before Catalytic Converter",
        0x0033: "DME: Oxygen Sensor Bank 2 After Catalytic Converter",
        0x0038: "DME: Oxygen Sensor Heating Before Catalytic Converter",
        0x0039: "DME: Oxygen Sensor Heating After Catalytic Converter",
        0x0040: "DME: VANOS Inlet",
        0x0041: "DME: VANOS Exhaust",
        0x0050: "DME: Air Mass Sensor",
        0x0051: "DME: Air Mass Sensor Signal",
        0x0054: "DME: Throttle Valve Potentiometer",
        0x0055: "DME: Throttle Valve Servo Motor",
        0x0056: "DME: Throttle Valve Adaptation",
        0x0060: "DME: Electronic Throttle Control",
        0x0062: "DME: Accelerator Pedal Position Sensor",
        0x0064: "DME: Vehicle Speed Signal",
        0x0070: "DME: Ignition Coil Cylinder 1",
        0x0071: "DME: Ignition Coil Cylinder 2",
        0x0072: "DME: Ignition Coil Cylinder 3",
        0x0073: "DME: Ignition Coil Cylinder 4",
        0x0074: "DME: Ignition Coil Cylinder 5",
        0x0075: "DME: Ignition Coil Cylinder 6",
        0x0080: "DME: Knock Sensor Cylinder 1",
        0x0081: "DME: Knock Sensor Cylinder 2",
        0x0082: "DME: Knock Sensor Cylinder 3",
        0x0083: "DME: Knock Sensor Cylinder 4",
        0x0090: "DME: Coolant Temperature Sensor",
        0x0091: "DME: Intake Air Temperature Sensor",
        0x0092: "DME: Oil Temperature Sensor",
        0x0094: "DME: Ambient Air Pressure Sensor",
        0x0100: "DME: Internal Control Module Fault",
        0x0101: "DME: EEPROM Error",
        0x0102: "DME: RAM Error",
        0x0103: "DME: ROM Error",
        0x0104: "DME: Watchdog Error",
        
        # EGS-specific codes
        0x1000: "EGS: Gear Monitoring",
        0x1001: "EGS: Gear Monitoring 1st",
        0x1002: "EGS: Gear Monitoring 2nd",
        0x1003: "EGS: Gear Monitoring 3rd",
        0x1004: "EGS: Gear Monitoring 4th",
        0x1005: "EGS: Gear Monitoring 5th",
        0x1010: "EGS: Shift Solenoid Valve 1",
        0x1011: "EGS: Shift Solenoid Valve 2",
        0x1012: "EGS: Shift Solenoid Valve 3",
        0x1013: "EGS: Shift Solenoid Valve 4",
        0x1020: "EGS: Torque Converter Lock-up Clutch",
        0x1030: "EGS: Transmission Output Speed Sensor",
        0x1031: "EGS: Turbine Speed Sensor",
        0x1040: "EGS: Gear Selector Switch",
        0x1041: "EGS: Gear Selector Position",
        0x1050: "EGS: CAN Communication Fault",
        0x1051: "EGS: CAN Message from DME Missing",
        0x1052: "EGS: CAN Message from ABS Missing",
        0x1053: "EGS: CAN Message from EML Missing",
        
        # ABS/DSC-specific codes
        0x2000: "ABS/DSC: Wheel Speed Sensor Front Left",
        0x2001: "ABS/DSC: Wheel Speed Sensor Front Right",
        0x2002: "ABS/DSC: Wheel Speed Sensor Rear Left",
        0x2003: "ABS/DSC: Wheel Speed Sensor Rear Right",
        0x2010: "ABS/DSC: Pressure Sensor",
        0x2011: "ABS/DSC: Steering Angle Sensor",
        0x2012: "ABS/DSC: Yaw Rate Sensor",
        0x2013: "ABS/DSC: Lateral Acceleration Sensor",
        0x2020: "ABS/DSC: DSC Valve Front Left",
        0x2021: "ABS/DSC: DSC Valve Front Right",
        0x2022: "ABS/DSC: DSC Valve Rear Left",
        0x2023: "ABS/DSC: DSC Valve Rear Right",
        0x2030: "ABS/DSC: Pump Motor",
        0x2040: "ABS/DSC: CAN Communication Fault",
        
        # Airbag (MRS) codes
        0x3000: "MRS: Driver Airbag Ignition",
        0x3001: "MRS: Passenger Airbag Ignition",
        0x3002: "MRS: Driver Side Airbag Ignition",
        0x3003: "MRS: Passenger Side Airbag Ignition",
        0x3004: "MRS: Driver Belt Tensioner",
        0x3005: "MRS: Passenger Belt Tensioner",
        0x3010: "MRS: Airbag Sensor Front Left",
        0x3011: "MRS: Airbag Sensor Front Right",
        0x3012: "MRS: Airbag Sensor Side Left",
        0x3013: "MRS: Airbag Sensor Side Right",
        0x3020: "MRS: Safety Battery Terminal",
        0x3030: "MRS: Warning Lamp",
        0x3040: "MRS: CAN Communication Fault",
        
        # IKE (Instrument Cluster)
        0x4000: "IKE: Vehicle Speed Signal",
        0x4001: "IKE: Engine Speed Signal",
        0x4002: "IKE: Coolant Temperature Signal",
        0x4003: "IKE: Fuel Level Signal",
        0x4004: "IKE: Oil Pressure Signal",
        0x4010: "IKE: LCD Display Fault",
        0x4011: "IKE: Gauge Stepper Motor",
        0x4020: "IKE: CAN Communication Fault",
        
        # GM (General Module)
        0x5000: "GM: Central Locking Driver Door",
        0x5001: "GM: Central Locking Passenger Door",
        0x5002: "GM: Central Locking Rear Left Door",
        0x5003: "GM: Central Locking Rear Right Door",
        0x5004: "GM: Central Locking Trunk",
        0x5010: "GM: Window Lift Driver",
        0x5011: "GM: Window Lift Passenger",
        0x5020: "GM: Interior Light",
        0x5030: "GM: Wiper Washer System",
        0x5040: "GM: CAN Communication Fault",
        
        # IHKA (Climate)
        0x6000: "IHKA: Blower Motor",
        0x6001: "IHKA: Interior Temperature Sensor",
        0x6002: "IHKA: Outside Temperature Sensor",
        0x6003: "IHKA: Evaporator Temperature Sensor",
        0x6010: "IHKA: Flap Motor Driver",
        0x6011: "IHKA: Flap Motor Passenger",
        0x6020: "IHKA: A/C Compressor",
        0x6030: "IHKA: CAN Communication Fault",
        
        # Radio
        0x7000: "RAD: Amplifier Output",
        0x7001: "RAD: CD Mechanism",
        0x7002: "RAD: Tuner",
        0x7010: "RAD: CAN Communication Fault",
        
        # Navigation
        0x8000: "NAV: GPS Receiver",
        0x8001: "NAV: DVD Drive",
        0x8010: "NAV: CAN Communication Fault",
    }
    
    @classmethod
    def get_description(cls, obd_code: str, raw: int, ecu_name: str = "") -> str:
        """Get description for an OBD-II code."""
        if obd_code in cls._COMMON_DTCS:
            return cls._COMMON_DTCS[obd_code]
        return f"Unknown code - refer to BMW documentation for {obd_code}"
    
    @classmethod
    def get_bmw_description(cls, raw: int, ecu_name: str = "") -> str:
        """Get description for a BMW-specific raw code."""
        if raw in cls._BMW_SPECIFIC:
            return cls._BMW_SPECIFIC[raw]
        
        # Try to infer from prefix
        prefix = (raw >> 12) & 0x0F
        if prefix == 0x0:
            return f"DME-related fault 0x{raw:04X}"
        elif prefix == 0x1:
            return f"EGS-related fault 0x{raw:04X}"
        elif prefix == 0x2:
            return f"ABS/DSC-related fault 0x{raw:04X}"
        elif prefix == 0x3:
            return f"MRS/Airbag-related fault 0x{raw:04X}"
        elif prefix == 0x4:
            return f"IKE/Instrument-related fault 0x{raw:04X}"
        elif prefix == 0x5:
            return f"GM/Body-related fault 0x{raw:04X}"
        elif prefix == 0x6:
            return f"IHKA/Climate-related fault 0x{raw:04X}"
        elif prefix == 0x7:
            return f"Radio/Audio-related fault 0x{raw:04X}"
        elif prefix == 0x8:
            return f"NAV-related fault 0x{raw:04X}"
        
        return f"BMW-specific fault 0x{raw:04X}"
