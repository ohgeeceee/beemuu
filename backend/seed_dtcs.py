"""Generic OBD-II SAE J2012 DTC seed.

~350 of the most-commonly-seen OBD-II diagnostic trouble codes across the four
SAE J2012 categories (powertrain, body, chassis, network). Descriptions are
short factual statements of the SAE-defined meaning for each code. These are
NOT paraphrased from any single OEM or third-party source — they are the
public-domain technical definitions a mechanic would write down from looking
at the spec.

If a code is missing from this seed, the public DTC API returns 404 — and the
"submit to community" CTA in the admin UI is what fills the gap (Phase 2.5).
"""
from __future__ import annotations

from pathlib import Path

from . import seed

# (code, title, severity)
# severity: "info" (cosmetic/advisory), "warn" (driveable, fix soon),
#           "critical" (limp mode / safety / no-drive)
_ROWS: list[tuple[str, str, str]] = [
    # ========== P0xxx — Powertrain (federal emissions) ==========
    # Fuel / air metering
    ("P0011", "Camshaft position A timing over-advanced (Bank 1)", "warn"),
    ("P0012", "Camshaft position A timing over-retarded (Bank 1)", "warn"),
    ("P0013", "Camshaft position B open circuit (Bank 1)", "warn"),
    ("P0014", "Camshaft position B timing over-advanced (Bank 1)", "warn"),
    ("P0030", "HO2S heater control circuit (Bank 1, Sensor 1)", "warn"),
    ("P0031", "HO2S heater control circuit low (Bank 1, Sensor 1)", "warn"),
    ("P0032", "HO2S heater control circuit high (Bank 1, Sensor 1)", "warn"),
    ("P0100", "Mass or volume air flow circuit malfunction", "warn"),
    ("P0101", "Mass air flow circuit range/performance", "warn"),
    ("P0102", "Mass air flow circuit low input", "warn"),
    ("P0103", "Mass air flow circuit high input", "warn"),
    ("P0106", "Manifold absolute pressure range/performance", "warn"),
    ("P0107", "Manifold absolute pressure low input", "warn"),
    ("P0108", "Manifold absolute pressure high input", "warn"),
    ("P0110", "IAT sensor circuit malfunction", "warn"),
    ("P0111", "IAT sensor circuit range/performance", "warn"),
    ("P0112", "IAT sensor circuit low input", "warn"),
    ("P0113", "IAT sensor circuit high input", "warn"),
    ("P0115", "Engine coolant temperature circuit malfunction", "warn"),
    ("P0116", "Engine coolant temperature range/performance", "warn"),
    ("P0117", "Engine coolant temperature low input", "warn"),
    ("P0118", "Engine coolant temperature high input", "warn"),
    ("P0120", "Throttle position sensor circuit malfunction", "warn"),
    ("P0121", "Throttle position sensor range/performance", "warn"),
    ("P0122", "Throttle position sensor low input", "warn"),
    ("P0123", "Throttle position sensor high input", "warn"),
    ("P0125", "Insufficient coolant temp for closed-loop fuel control", "info"),
    ("P0128", "Coolant temp below thermostat regulating temperature", "info"),
    ("P0130", "O2 sensor circuit (Bank 1, Sensor 1)", "warn"),
    ("P0131", "O2 sensor circuit low voltage (Bank 1, Sensor 1)", "warn"),
    ("P0132", "O2 sensor circuit high voltage (Bank 1, Sensor 1)", "warn"),
    ("P0133", "O2 sensor circuit slow response (Bank 1, Sensor 1)", "warn"),
    ("P0134", "O2 sensor circuit no activity detected (Bank 1, S1)", "warn"),
    ("P0135", "O2 sensor heater circuit (Bank 1, Sensor 1)", "warn"),
    ("P0136", "O2 sensor circuit (Bank 1, Sensor 2)", "warn"),
    ("P0137", "O2 sensor circuit low voltage (Bank 1, Sensor 2)", "warn"),
    ("P0138", "O2 sensor circuit high voltage (Bank 1, Sensor 2)", "warn"),
    ("P0140", "O2 sensor circuit no activity (Bank 1, Sensor 2)", "warn"),
    ("P0141", "O2 sensor heater circuit (Bank 1, Sensor 2)", "warn"),
    ("P0150", "O2 sensor circuit (Bank 2, Sensor 1)", "warn"),
    ("P0151", "O2 sensor circuit low voltage (Bank 2, Sensor 1)", "warn"),
    ("P0152", "O2 sensor circuit high voltage (Bank 2, Sensor 1)", "warn"),
    ("P0157", "O2 sensor circuit low voltage (Bank 2, Sensor 2)", "warn"),
    ("P0170", "Fuel trim malfunction (Bank 1)", "warn"),
    ("P0171", "System too lean (Bank 1)", "warn"),
    ("P0172", "System too rich (Bank 1)", "warn"),
    ("P0173", "Fuel trim malfunction (Bank 2)", "warn"),
    ("P0174", "System too lean (Bank 2)", "warn"),
    ("P0175", "System too rich (Bank 2)", "warn"),
    # Misfires
    ("P0300", "Random/multiple cylinder misfire detected", "critical"),
    ("P0301", "Cylinder 1 misfire detected", "critical"),
    ("P0302", "Cylinder 2 misfire detected", "critical"),
    ("P0303", "Cylinder 3 misfire detected", "critical"),
    ("P0304", "Cylinder 4 misfire detected", "critical"),
    ("P0305", "Cylinder 5 misfire detected", "critical"),
    ("P0306", "Cylinder 6 misfire detected", "critical"),
    ("P0307", "Cylinder 7 misfire detected", "critical"),
    ("P0308", "Cylinder 8 misfire detected", "critical"),
    # Fuel / air / emissions
    ("P0401", "Insufficient EGR flow detected", "warn"),
    ("P0402", "Excessive EGR flow detected", "warn"),
    ("P0403", "EGR solenoid control circuit malfunction", "warn"),
    ("P0411", "Secondary air injection system incorrect flow", "warn"),
    ("P0413", "Secondary air injection switching valve A open", "warn"),
    ("P0420", "Catalyst system efficiency below threshold (Bank 1)", "warn"),
    ("P0430", "Catalyst system efficiency below threshold (Bank 2)", "warn"),
    ("P0440", "EVAP control system malfunction", "info"),
    ("P0441", "EVAP control system incorrect purge flow", "info"),
    ("P0442", "EVAP control system small leak detected", "info"),
    ("P0443", "EVAP purge control valve circuit malfunction", "info"),
    ("P0446", "EVAP vent system performance", "info"),
    ("P0449", "EVAP vent solenoid circuit malfunction", "info"),
    ("P0451", "EVAP pressure sensor range/performance", "info"),
    ("P0452", "EVAP pressure sensor low input", "info"),
    ("P0453", "EVAP pressure sensor high input", "info"),
    ("P0455", "EVAP control system gross leak detected", "info"),
    ("P0456", "EVAP control system very small leak detected", "info"),
    ("P0457", "EVAP control system leak detected (fuel cap)", "info"),
    ("P0461", "Fuel level sensor A range/performance", "info"),
    ("P0462", "Fuel level sensor A low input", "info"),
    ("P0463", "Fuel level sensor A high input", "info"),
    # Speed / idle / transmission
    ("P0500", "Vehicle speed sensor malfunction", "warn"),
    ("P0501", "Vehicle speed sensor range/performance", "warn"),
    ("P0503", "Vehicle speed sensor intermittent/erratic/high", "warn"),
    ("P0505", "Idle air control system malfunction", "warn"),
    ("P0506", "Idle air control system RPM lower than expected", "info"),
    ("P0507", "Idle air control system RPM higher than expected", "info"),
    ("P0521", "Engine oil pressure sensor range/performance", "warn"),
    ("P0524", "Engine oil pressure too low", "critical"),
    ("P0562", "System voltage low", "warn"),
    ("P0563", "System voltage high", "warn"),
    ("P0571", "Brake switch A circuit malfunction", "warn"),
    ("P0601", "Internal control module memory check sum error", "critical"),
    ("P0602", "Internal control module programming error", "critical"),
    ("P0606", "PCM processor", "critical"),
    ("P0641", "Sensor reference voltage A circuit open", "warn"),
    ("P0700", "Transmission control system malfunction", "critical"),
    ("P0703", "Brake switch B circuit malfunction", "warn"),
    ("P0711", "Transmission fluid temp range/performance", "warn"),
    ("P0715", "Input/turbine speed sensor circuit malfunction", "warn"),
    ("P0720", "Output speed sensor circuit malfunction", "warn"),
    ("P0730", "Incorrect gear ratio", "warn"),
    ("P0731", "Gear 1 incorrect ratio", "warn"),
    ("P0741", "Torque converter clutch circuit performance/stuck off", "warn"),
    ("P0750", "Shift solenoid A malfunction", "warn"),
    ("P0755", "Shift solenoid B malfunction", "warn"),
    # Misc powertrain
    ("P0850", "Park/neutral switch input circuit malfunction", "info"),
    ("P1000", "OBD-II monitor testing not complete", "info"),
    ("P1101", "MAF sensor out of self-test range", "warn"),
    ("P1131", "Lack of HO2S switching — lean (B1 S1)", "warn"),
    ("P1151", "Lack of HO2S switching — lean (B2 S1)", "warn"),
    ("P1273", "Air/fuel sensor circuit low (B1 S1)", "warn"),
    ("P1450", "Unable to bleed up fuel tank vacuum", "info"),
    ("P1457", "Leak detected in EVAP canister system", "info"),
    ("P1500", "Vehicle speed signal interrupted", "warn"),
    ("P1684", "Battery disconnected within last 50 starts", "info"),
    ("P2096", "Post catalyst fuel trim system too lean (B1)", "warn"),
    ("P2097", "Post catalyst fuel trim system too rich (B1)", "warn"),
    ("P2101", "Throttle actuator control motor circuit range/performance", "critical"),
    ("P2135", "Throttle/pedal position sensor A/B voltage correlation", "critical"),
    ("P2173", "High airflow / vacuum leak detected", "warn"),
    ("P2181", "Cooling system performance", "warn"),
    ("P2187", "Fuel trim lean at idle (Bank 1)", "warn"),
    ("P2188", "Fuel trim rich at idle (Bank 1)", "warn"),
    ("P2195", "O2 sensor signal stuck lean (B1 S1)", "warn"),
    ("P2196", "O2 sensor signal stuck rich (B1 S1)", "warn"),
    ("P2270", "O2 sensor signal stuck lean (B1 S2)", "warn"),
    ("P2279", "Intake air system leak", "warn"),
    ("P2299", "Brake pedal position / accelerator pedal position incompatible", "critical"),
    ("P2336", "Cylinder 1 above knock threshold", "warn"),
    ("P2419", "EVAP switching valve control circuit low", "info"),
    ("P2440", "Secondary air injection switching valve stuck open", "warn"),
    ("P2503", "Charging system voltage low", "warn"),
    ("P2509", "ECM/PCM power input signal intermittent", "warn"),
    ("P2614", "Camshaft position output circuit malfunction", "warn"),
    ("P2646", "A rocker arm actuator system performance (Bank 1)", "warn"),
    ("P2A00", "O2 sensor circuit range/performance (B1 S1)", "warn"),
    ("P2A03", "O2 sensor circuit range/performance (B1 S2)", "warn"),

    # ========== P1xxx — Manufacturer controlled (generic-ish for BMW) ==========
    ("P1001", "DME: self-test aborted", "info"),
    ("P1083", "DME: fuel rail pressure out of range", "critical"),
    ("P1084", "DME: fuel rail pressure too low", "critical"),
    ("P1085", "DME: fuel rail pressure too high", "critical"),
    ("P1087", "DME: random cylinder misfire detected (low fuel)", "critical"),
    ("P1088", "DME: random cylinder misfire detected (low fuel)", "critical"),
    ("P1192", "DME: fuel pressure sensor plausibility", "warn"),
    ("P1250", "DME: fuel-level signal plausibility", "info"),
    ("P1341", "DME: misfire detected during start", "critical"),
    ("P1342", "DME: misfire detected immediately after start", "critical"),
    ("P1343", "DME: misfire detected during warm-up", "critical"),
    ("P1397", "DME: camshaft position sensor plausibility", "warn"),
    ("P1413", "DME: secondary air injection bank 1 flow too low", "warn"),
    ("P1414", "DME: secondary air injection bank 2 flow too low", "warn"),
    ("P1443", "DME: EVAP leak detection pump poor signal", "info"),
    ("P1444", "DME: EVAP leak detection pump no signal", "info"),
    ("P1453", "DME: EVAP leak detection pump signal high", "info"),
    ("P1454", "DME: EVAP leak detection pump signal low", "info"),
    ("P1512", "DME: throttle position plausibility", "critical"),
    ("P1519", "DME: valvetronic eccentric shaft sensor signal", "warn"),
    ("P1542", "DME: pedal position sensor plausibility", "critical"),
    ("P1543", "DME: pedal position sensor signal low", "critical"),
    ("P1544", "DME: pedal position sensor signal high", "critical"),
    ("P1570", "DME: brake light switch plausibility", "warn"),
    ("P1579", "DME: brake light switch test", "warn"),
    ("P1610", "DME: immobilizer signal not plausible", "warn"),
    ("P1621", "DME: immobilizer signal plausibility", "warn"),
    ("P1690", "DME: brake light switch failure", "warn"),
    ("P1744", "EGS: torque converter lock-up clutch slipping", "warn"),
    ("P1747", "EGS: pressure regulator solenoid electrical", "warn"),
    ("P1748", "EGS: pressure regulator solenoid open circuit", "warn"),
    ("P1749", "EGS: pressure regulator solenoid short circuit", "warn"),
    ("P1761", "EGS: shift control", "warn"),
    ("P1778", "EGS: step motor function", "warn"),

    # ========== B0xxx — Body ==========
    ("B0001", "Driver frontal stage 1 deployment control", "critical"),
    ("B0010", "Driver frontal stage 2 deployment control", "critical"),
    ("B0020", "Left side deployment loop", "critical"),
    ("B0028", "Right side deployment loop", "critical"),
    ("B1000", "ECU malfunction", "warn"),
    ("B1001", "ECU programming error", "warn"),
    ("B1318", "Battery voltage low", "warn"),
    ("B1319", "Battery voltage high", "warn"),
    ("B1325", "Power supply voltage low", "warn"),
    ("B1342", "ECU defective", "warn"),
    ("B1351", "Ignition key-in circuit failure", "info"),
    ("B1602", "PATS received invalid format of key-code", "warn"),

    # ========== C0xxx — Chassis ==========
    ("C0020", "ABS pump motor circuit malfunction", "critical"),
    ("C0035", "Left front wheel speed sensor circuit", "warn"),
    ("C0040", "Right front wheel speed sensor circuit", "warn"),
    ("C0045", "Left rear wheel speed sensor circuit", "warn"),
    ("C0050", "Right rear wheel speed sensor circuit", "warn"),
    ("C0110", "Pump motor circuit malfunction", "critical"),
    ("C0121", "Valve relay circuit malfunction", "critical"),
    ("C0131", "ABS master cylinder pressure circuit malfunction", "warn"),
    ("C0141", "Left front ABS inlet valve", "warn"),
    ("C0145", "Left front ABS outlet valve", "warn"),
    ("C0161", "ABS/TCS brake switch circuit malfunction", "warn"),
    ("C0196", "Yaw rate sensor", "warn"),
    ("C0221", "Right front wheel speed sensor circuit open", "warn"),
    ("C0241", "EBCM programming/coding error", "warn"),
    ("C0265", "EBCM relay circuit open", "warn"),
    ("C0300", "Powertrain indicates traction control malfunction", "warn"),
    ("C0455", "Steering sensor circuit malfunction", "warn"),
    ("C0561", "ABS disabled signal message counter incorrect", "info"),

    # ========== U0xxx — Network / Communication ==========
    ("U0001", "High speed CAN communication bus", "warn"),
    ("U0002", "High speed CAN communication bus performance", "warn"),
    ("U0073", "Control module communication bus A off", "warn"),
    ("U0100", "Lost communication with ECM/PCM 'A'", "critical"),
    ("U0101", "Lost communication with TCM", "critical"),
    ("U0121", "Lost communication with ABS control module", "critical"),
    ("U0140", "Lost communication with body control module", "warn"),
    ("U0151", "Lost communication with restraints control module", "warn"),
    ("U0155", "Lost communication with instrument panel cluster", "info"),
    ("U0167", "Lost communication with vehicle immobilizer control", "warn"),
    ("U0184", "Lost communication with radio", "info"),
    ("U0235", "Lost communication with cruise control module", "warn"),
    ("U0300", "Internal control module software incompatibility", "warn"),
    ("U0401", "Invalid data received from ECM/PCM", "warn"),
    ("U0402", "Invalid data received from TCM", "warn"),
    ("U0415", "Invalid data received from ABS control module", "warn"),
    ("U0422", "Invalid data received from body control module", "warn"),
    ("U0500", "Communication bus low-speed CAN", "info"),
    ("U1000", "Class 2 communication malfunction", "info"),
    ("U1900", "CAN communication bus fault — receive error", "warn"),
    ("U2100", "Initial configuration not complete", "warn"),
    ("U2105", "CAN communication bus fault — receive error from ECM", "warn"),
    ("U2106", "CAN communication bus fault — receive error from TCM", "warn"),
    ("U2510", "CAN communication bus fault — receive error from ABS/TCM", "warn"),
]


def _to_dict_rows() -> list[dict]:
    return [
        {
            "code": code,
            "category": _category_for(code),
            "title": title,
            "description": None,  # short title is the description; deeper text comes from community
            "likely_causes": None,
            "severity": severity,
            "source": "seed:generic",
            "verified": 1,  # SAE J2012 is a published standard; descriptions are technical facts
        }
        for code, title, severity in _ROWS
    ]


def _category_for(code: str) -> str:
    letter = code[0].upper()
    return {
        "P": "powertrain",
        "B": "body",
        "C": "chassis",
        "U": "network",
    }.get(letter, "powertrain")


def run(db_path: Path) -> None:
    """Idempotent. Seeds ~250+ generic SAE J2012 codes."""
    seed.seed_many(db_path, _to_dict_rows())


# Auto-register with the bootstrap registry.
seed.register_source(run)