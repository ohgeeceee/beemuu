/* GENERATED FILE — do not edit.
 * Source: community/profiles/*.toml
 * Regenerate: python3 scripts/gen_signal_index.py
 *
 * Loaded by index.html as a plain script because the Tauri webview
 * cannot fetch a relative asset path. v3_signal_index.js turns this
 * into the index signal_library.build() consumes.
 */
window.beeemuuSignalIndexData = {
  "generated_by": "scripts/gen_signal_index.py",
  "note": "Generated file — do not edit by hand. Re-run `python3 scripts/gen_signal_index.py` after changing a community profile. `src/js/signal_library.js` grades each signal's confidence from its query form and any [needs verification] note in its label.",
  "profiles": [
    {
      "id": "b48",
      "label": "B48/B46 2.0 turbo I4 (modular B-family, F/G-series) [community, needs verification]",
      "param": [
        {
          "decode": "u16_quarter",
          "id": "rpm",
          "label": "Engine speed",
          "max": 7000.0,
          "min": 0.0,
          "query": "obd:0C",
          "target": 18,
          "unit": "rpm"
        },
        {
          "decode": "temp_u8",
          "id": "coolant",
          "label": "Coolant temp",
          "max": 150.0,
          "min": -40.0,
          "query": "obd:05",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "iat",
          "label": "Intake air temp (post-IC)",
          "max": 100.0,
          "min": -40.0,
          "query": "obd:0F",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u8",
          "id": "map",
          "label": "Manifold pressure (abs)",
          "max": 255.0,
          "min": 0.0,
          "query": "obd:0B",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u8",
          "id": "baro",
          "label": "Barometric pressure",
          "max": 110.0,
          "min": 60.0,
          "query": "obd:33",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "percent_a",
          "id": "load",
          "label": "Engine load",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:04",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "percent_a",
          "id": "throttle",
          "label": "Throttle position",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:11",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "u8",
          "id": "speed",
          "label": "Vehicle speed",
          "max": 300.0,
          "min": 0.0,
          "query": "obd:0D",
          "target": 18,
          "unit": "km/h"
        },
        {
          "decode": "u16_milli",
          "id": "volt",
          "label": "Module voltage",
          "max": 16.0,
          "min": 8.0,
          "query": "obd:42",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "temp_u8",
          "id": "ambient",
          "label": "Ambient temp",
          "max": 60.0,
          "min": -40.0,
          "query": "obd:46",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u16_tenths",
          "id": "battery_v",
          "label": "Battery voltage (DME) [needs verification]",
          "max": 16.0,
          "min": 8.0,
          "query": "did:4002",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "u16_tenths",
          "id": "hpfp_rail",
          "label": "HPFP rail pressure [needs verification]",
          "max": 25.5,
          "min": 0.0,
          "query": "did:44F0",
          "target": 18,
          "unit": "MPa"
        },
        {
          "decode": "u16_tenths",
          "id": "boost_cmd",
          "label": "Boost command (relative) [needs verification]",
          "max": 300.0,
          "min": -100.0,
          "query": "did:4367",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u16_div100",
          "id": "maf",
          "label": "Mass air flow [needs verification]",
          "max": 655.35,
          "min": 0.0,
          "query": "did:4077",
          "target": 18,
          "unit": "kg/h"
        },
        {
          "decode": "u16_div100",
          "id": "ambient_pres",
          "label": "Ambient pressure (DME) [needs verification]",
          "max": 110.0,
          "min": 60.0,
          "query": "did:4003",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "s16_div4",
          "id": "dme_temp",
          "label": "DME temperature (signed, 0.25C resolution) [needs verification]",
          "max": 150.0,
          "min": -40.0,
          "query": "did:4001",
          "target": 18,
          "unit": "C"
        },
        {
          "decode": "s16_div100",
          "id": "eng_torque",
          "label": "Engine torque (signed) [needs verification]",
          "max": 327.67,
          "min": -327.68,
          "query": "did:4500",
          "target": 18,
          "unit": "Nm"
        },
        {
          "decode": "u8_div100",
          "id": "lambda_1",
          "label": "Lambda bank 1 [needs verification]",
          "max": 1.5,
          "min": 0.5,
          "query": "did:400B",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_div100",
          "id": "inj_time",
          "label": "Injection time (per cylinder) [needs verification, UDS only]",
          "max": 2.55,
          "min": 0.0,
          "query": "did:4363",
          "target": 18,
          "unit": "ms"
        },
        {
          "decode": "u8_enum",
          "id": "gear",
          "label": "Gear position (EGS) [needs verification, UDS only]",
          "max": 15.0,
          "min": 0.0,
          "query": "did:DA0A",
          "target": 24,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "engine_state",
          "label": "Engine state (DME) [needs verification, UDS only]",
          "max": 5.0,
          "min": 0.0,
          "query": "did:4004",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "knock_detect",
          "label": "Knock detection (DME) [needs verification, UDS only]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:401F",
          "target": 18,
          "unit": ""
        }
      ]
    },
    {
      "id": "b58",
      "label": "B58 3.0 turbo I6 (DME 8.x, F/G-series) [community, OBDb-verified DIDs]",
      "param": [
        {
          "decode": "u16_quarter",
          "id": "rpm",
          "label": "Engine speed",
          "max": 7000.0,
          "min": 0.0,
          "query": "obd:0C",
          "target": 18,
          "unit": "rpm"
        },
        {
          "decode": "temp_u8",
          "id": "coolant",
          "label": "Coolant temp",
          "max": 150.0,
          "min": -40.0,
          "query": "obd:05",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "iat",
          "label": "Intake air temp (post-IC)",
          "max": 100.0,
          "min": -40.0,
          "query": "obd:0F",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u8",
          "id": "map",
          "label": "Manifold pressure (abs)",
          "max": 255.0,
          "min": 0.0,
          "query": "obd:0B",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u8",
          "id": "baro",
          "label": "Barometric pressure",
          "max": 110.0,
          "min": 60.0,
          "query": "obd:33",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "percent_a",
          "id": "load",
          "label": "Engine load",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:04",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "percent_a",
          "id": "throttle",
          "label": "Throttle position",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:11",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "u8",
          "id": "speed",
          "label": "Vehicle speed",
          "max": 300.0,
          "min": 0.0,
          "query": "obd:0D",
          "target": 18,
          "unit": "km/h"
        },
        {
          "decode": "u16_milli",
          "id": "volt",
          "label": "Module voltage",
          "max": 16.0,
          "min": 8.0,
          "query": "obd:42",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "temp_u8",
          "id": "ambient",
          "label": "Ambient temp",
          "max": 60.0,
          "min": -40.0,
          "query": "obd:46",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u16_tenths",
          "id": "battery_v",
          "label": "Battery voltage (DME)",
          "max": 16.0,
          "min": 8.0,
          "query": "did:4002",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "u16_tenths",
          "id": "hpfp_rail",
          "label": "HPFP rail pressure",
          "max": 25.5,
          "min": 0.0,
          "query": "did:44F0",
          "target": 18,
          "unit": "MPa"
        },
        {
          "decode": "u16_tenths",
          "id": "boost_cmd",
          "label": "Boost command (relative)",
          "max": 300.0,
          "min": -100.0,
          "query": "did:4367",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u16_div100",
          "id": "maf",
          "label": "Mass air flow",
          "max": 655.35,
          "min": 0.0,
          "query": "did:4077",
          "target": 18,
          "unit": "kg/h"
        },
        {
          "decode": "u16_div100",
          "id": "ambient_pres",
          "label": "Ambient pressure (DME)",
          "max": 110.0,
          "min": 60.0,
          "query": "did:4003",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "s16_div4",
          "id": "dme_temp",
          "label": "DME temperature (signed, 0.25C resolution)",
          "max": 150.0,
          "min": -40.0,
          "query": "did:4001",
          "target": 18,
          "unit": "C"
        },
        {
          "decode": "s16_div100",
          "id": "eng_torque",
          "label": "Engine torque (signed)",
          "max": 327.67,
          "min": -327.68,
          "query": "did:4500",
          "target": 18,
          "unit": "Nm"
        },
        {
          "decode": "u8_div100",
          "id": "lambda_1",
          "label": "Lambda bank 1",
          "max": 1.5,
          "min": 0.5,
          "query": "did:400B",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_div100",
          "id": "inj_time",
          "label": "Injection time (per cylinder) [needs verification, UDS only]",
          "max": 2.55,
          "min": 0.0,
          "query": "did:4363",
          "target": 18,
          "unit": "ms"
        },
        {
          "decode": "u8_enum",
          "id": "gear",
          "label": "Gear position (EGS)",
          "max": 15.0,
          "min": 0.0,
          "query": "did:DA0A",
          "target": 24,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "engine_state",
          "label": "Engine state (DME) [needs verification]",
          "max": 5.0,
          "min": 0.0,
          "query": "did:4004",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "knock_detect",
          "label": "Knock detection (DME) [needs verification]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:401F",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u16_fiftieths",
          "id": "inj_duty",
          "label": "Injector duty cycle (DME) [needs verification, UDS only]",
          "max": 100.0,
          "min": 0.0,
          "query": "did:4402",
          "target": 18,
          "unit": "%"
        }
      ]
    },
    {
      "id": "e70_n62_example",
      "label": "E70 X5 4.8i (N62B48) — example, verify before trusting",
      "param": [
        {
          "decode": "u16_quarter",
          "id": "rpm",
          "label": "Engine speed",
          "max": 7000.0,
          "min": 0.0,
          "query": "obd:0C",
          "target": 18,
          "unit": "rpm"
        },
        {
          "decode": "temp_u8",
          "id": "coolant",
          "label": "Coolant temp",
          "max": 150.0,
          "min": -40.0,
          "query": "obd:05",
          "target": 18,
          "unit": "°C"
        }
      ]
    },
    {
      "id": "n20",
      "label": "N20/N26 2.0 turbo I4 (MEVD17.2, F-series) [community, needs verification]",
      "param": [
        {
          "decode": "u16_quarter",
          "id": "rpm",
          "label": "Engine speed",
          "max": 7000.0,
          "min": 0.0,
          "query": "obd:0C",
          "target": 18,
          "unit": "rpm"
        },
        {
          "decode": "temp_u8",
          "id": "coolant",
          "label": "Coolant temp",
          "max": 150.0,
          "min": -40.0,
          "query": "obd:05",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "iat",
          "label": "Intake air temp (post-IC)",
          "max": 100.0,
          "min": -40.0,
          "query": "obd:0F",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u8",
          "id": "map",
          "label": "Manifold pressure (abs)",
          "max": 255.0,
          "min": 0.0,
          "query": "obd:0B",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u8",
          "id": "baro",
          "label": "Barometric pressure",
          "max": 110.0,
          "min": 60.0,
          "query": "obd:33",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "percent_a",
          "id": "load",
          "label": "Engine load",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:04",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "percent_a",
          "id": "throttle",
          "label": "Throttle position",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:11",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "u8",
          "id": "speed",
          "label": "Vehicle speed",
          "max": 300.0,
          "min": 0.0,
          "query": "obd:0D",
          "target": 18,
          "unit": "km/h"
        },
        {
          "decode": "u16_milli",
          "id": "volt",
          "label": "Module voltage",
          "max": 16.0,
          "min": 8.0,
          "query": "obd:42",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "temp_u8",
          "id": "ambient",
          "label": "Ambient temp",
          "max": 60.0,
          "min": -40.0,
          "query": "obd:46",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u16_tenths",
          "id": "battery_v",
          "label": "Battery voltage (DME) [needs verification]",
          "max": 16.0,
          "min": 8.0,
          "query": "did:4002",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "u16_tenths",
          "id": "hpfp_rail",
          "label": "HPFP rail pressure [needs verification]",
          "max": 25.5,
          "min": 0.0,
          "query": "did:44F0",
          "target": 18,
          "unit": "MPa"
        },
        {
          "decode": "u16_tenths",
          "id": "boost_cmd",
          "label": "Boost command (relative) [needs verification]",
          "max": 300.0,
          "min": -100.0,
          "query": "did:4367",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u16_div100",
          "id": "maf",
          "label": "Mass air flow [needs verification]",
          "max": 655.35,
          "min": 0.0,
          "query": "did:4077",
          "target": 18,
          "unit": "kg/h"
        },
        {
          "decode": "u16_div100",
          "id": "ambient_pres",
          "label": "Ambient pressure (DME) [needs verification]",
          "max": 110.0,
          "min": 60.0,
          "query": "did:4003",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "s16_div4",
          "id": "dme_temp",
          "label": "DME temperature (signed, 0.25C resolution) [needs verification]",
          "max": 150.0,
          "min": -40.0,
          "query": "did:4001",
          "target": 18,
          "unit": "C"
        },
        {
          "decode": "s16_div100",
          "id": "eng_torque",
          "label": "Engine torque (signed) [needs verification]",
          "max": 327.67,
          "min": -327.68,
          "query": "did:4500",
          "target": 18,
          "unit": "Nm"
        },
        {
          "decode": "u8_div100",
          "id": "lambda_1",
          "label": "Lambda bank 1 [needs verification]",
          "max": 1.5,
          "min": 0.5,
          "query": "did:400B",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_div100",
          "id": "inj_time",
          "label": "Injection time (per cylinder) [needs verification, UDS only]",
          "max": 2.55,
          "min": 0.0,
          "query": "did:4363",
          "target": 18,
          "unit": "ms"
        },
        {
          "decode": "u8_enum",
          "id": "gear",
          "label": "Gear position (EGS) [needs verification, UDS only]",
          "max": 15.0,
          "min": 0.0,
          "query": "did:DA0A",
          "target": 24,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "engine_state",
          "label": "Engine state (DME) [needs verification, UDS only]",
          "max": 5.0,
          "min": 0.0,
          "query": "did:4004",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "knock_detect",
          "label": "Knock detection (DME) [needs verification, UDS only]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:401F",
          "target": 18,
          "unit": ""
        }
      ]
    },
    {
      "id": "n52",
      "label": "N52 2.5/3.0 NA I6 (MSV70/MSV80) [community]",
      "param": [
        {
          "decode": "u16_quarter",
          "id": "rpm",
          "label": "Engine speed",
          "max": 7000.0,
          "min": 0.0,
          "query": "obd:0C",
          "target": 18,
          "unit": "rpm"
        },
        {
          "decode": "temp_u8",
          "id": "coolant",
          "label": "Coolant temp",
          "max": 150.0,
          "min": -40.0,
          "query": "obd:05",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "oil",
          "label": "Oil temp",
          "max": 160.0,
          "min": -40.0,
          "query": "obd:5C",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "iat",
          "label": "Intake air temp",
          "max": 80.0,
          "min": -40.0,
          "query": "obd:0F",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "percent_a",
          "id": "load",
          "label": "Engine load",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:04",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "percent_a",
          "id": "throttle",
          "label": "Throttle position",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:11",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "u8",
          "id": "map",
          "label": "Manifold pressure",
          "max": 120.0,
          "min": 0.0,
          "query": "obd:0B",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u8",
          "id": "speed",
          "label": "Vehicle speed",
          "max": 300.0,
          "min": 0.0,
          "query": "obd:0D",
          "target": 18,
          "unit": "km/h"
        },
        {
          "decode": "u16_milli",
          "id": "volt",
          "label": "Module voltage",
          "max": 16.0,
          "min": 8.0,
          "query": "obd:42",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "temp_u8",
          "id": "ambient",
          "label": "Ambient temp",
          "max": 60.0,
          "min": -40.0,
          "query": "obd:46",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u16_fiftieths",
          "id": "fuel_rate_lh",
          "label": "Engine fuel rate (L/h) [needs verification, N52/E9x bench]",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:5E",
          "target": 18,
          "unit": "L/h"
        },
        {
          "decode": "u32_be",
          "id": "engine_runtime",
          "label": "Engine runtime [needs verification, N52/E9x bench]",
          "max": 4294967295.0,
          "min": 0.0,
          "query": "obd:5F",
          "target": 18,
          "unit": "s"
        },
        {
          "decode": "u16_half",
          "id": "fuel_rate_gs",
          "label": "Engine fuel rate (g/s) [needs verification, N52/E9x bench]",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:62",
          "target": 18,
          "unit": "g/s"
        }
      ]
    },
    {
      "id": "n54",
      "label": "N54 3.0 twin-turbo I6 (MSD80/81) [community]",
      "param": [
        {
          "decode": "u16_quarter",
          "id": "rpm",
          "label": "Engine speed",
          "max": 7000.0,
          "min": 0.0,
          "query": "obd:0C",
          "target": 18,
          "unit": "rpm"
        },
        {
          "decode": "temp_u8",
          "id": "coolant",
          "label": "Coolant temp",
          "max": 150.0,
          "min": -40.0,
          "query": "obd:05",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "oil",
          "label": "Oil temp",
          "max": 160.0,
          "min": -40.0,
          "query": "obd:5C",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "iat",
          "label": "Intake air temp (post-IC)",
          "max": 100.0,
          "min": -40.0,
          "query": "obd:0F",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u8",
          "id": "map",
          "label": "Manifold pressure (abs)",
          "max": 255.0,
          "min": 0.0,
          "query": "obd:0B",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u8",
          "id": "baro",
          "label": "Barometric pressure",
          "max": 110.0,
          "min": 60.0,
          "query": "obd:33",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u16_times10",
          "id": "rail",
          "label": "Fuel rail pressure (HPFP)",
          "max": 25000.0,
          "min": 0.0,
          "query": "obd:23",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "percent_a",
          "id": "load",
          "label": "Engine load",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:04",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "percent_a",
          "id": "throttle",
          "label": "Throttle position",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:11",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "u8",
          "id": "speed",
          "label": "Vehicle speed",
          "max": 300.0,
          "min": 0.0,
          "query": "obd:0D",
          "target": 18,
          "unit": "km/h"
        },
        {
          "decode": "u16_milli",
          "id": "volt",
          "label": "Module voltage",
          "max": 16.0,
          "min": 8.0,
          "query": "obd:42",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "temp_u8",
          "id": "ambient",
          "label": "Ambient temp",
          "max": 60.0,
          "min": -40.0,
          "query": "obd:46",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u16_fiftieths",
          "id": "fuel_rate_lh",
          "label": "Engine fuel rate (L/h) [needs verification, N54/E9x bench]",
          "max": 200.0,
          "min": 0.0,
          "query": "obd:5E",
          "target": 18,
          "unit": "L/h"
        },
        {
          "decode": "u32_be",
          "id": "engine_runtime",
          "label": "Engine runtime [needs verification, N54/E9x bench]",
          "max": 4294967295.0,
          "min": 0.0,
          "query": "obd:5F",
          "target": 18,
          "unit": "s"
        },
        {
          "decode": "u16_half",
          "id": "fuel_rate_gs",
          "label": "Engine fuel rate (g/s) [needs verification, N54/E9x bench]",
          "max": 200.0,
          "min": 0.0,
          "query": "obd:62",
          "target": 18,
          "unit": "g/s"
        }
      ]
    },
    {
      "id": "n55",
      "label": "N55 3.0 turbo I6 (MSD81/MEVD17.2) [community, oil temp unverified]",
      "param": [
        {
          "decode": "u16_quarter",
          "id": "rpm",
          "label": "Engine speed",
          "max": 7000.0,
          "min": 0.0,
          "query": "obd:0C",
          "target": 18,
          "unit": "rpm"
        },
        {
          "decode": "temp_u8",
          "id": "coolant",
          "label": "Coolant temp",
          "max": 150.0,
          "min": -40.0,
          "query": "obd:05",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "oil",
          "label": "Oil temp [UNVERIFIED placeholder]",
          "max": 160.0,
          "min": -40.0,
          "query": "local:10",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "iat",
          "label": "Intake air temp (post-IC)",
          "max": 100.0,
          "min": -40.0,
          "query": "obd:0F",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u8",
          "id": "map",
          "label": "Manifold pressure (abs)",
          "max": 255.0,
          "min": 0.0,
          "query": "obd:0B",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u8",
          "id": "baro",
          "label": "Barometric pressure",
          "max": 110.0,
          "min": 60.0,
          "query": "obd:33",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "percent_a",
          "id": "load",
          "label": "Engine load",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:04",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "percent_a",
          "id": "throttle",
          "label": "Throttle position",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:11",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "u8",
          "id": "speed",
          "label": "Vehicle speed",
          "max": 300.0,
          "min": 0.0,
          "query": "obd:0D",
          "target": 18,
          "unit": "km/h"
        },
        {
          "decode": "u16_milli",
          "id": "volt",
          "label": "Module voltage",
          "max": 16.0,
          "min": 8.0,
          "query": "obd:42",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "temp_u8",
          "id": "ambient",
          "label": "Ambient temp",
          "max": 60.0,
          "min": -40.0,
          "query": "obd:46",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u16_tenths",
          "id": "battery_v",
          "label": "Battery voltage (DME)",
          "max": 16.0,
          "min": 8.0,
          "query": "did:4002",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "u16_tenths",
          "id": "hpfp_rail",
          "label": "HPFP rail pressure",
          "max": 25.5,
          "min": 0.0,
          "query": "did:44F0",
          "target": 18,
          "unit": "MPa"
        },
        {
          "decode": "u16_tenths",
          "id": "boost_cmd",
          "label": "Boost command (relative)",
          "max": 300.0,
          "min": -100.0,
          "query": "did:4367",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u16_div100",
          "id": "maf",
          "label": "Mass air flow",
          "max": 655.35,
          "min": 0.0,
          "query": "did:4077",
          "target": 18,
          "unit": "kg/h"
        },
        {
          "decode": "u16_div100",
          "id": "ambient_pres",
          "label": "Ambient pressure (DME)",
          "max": 110.0,
          "min": 60.0,
          "query": "did:4003",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "s16_div4",
          "id": "dme_temp",
          "label": "DME temperature (signed, 0.25C resolution)",
          "max": 150.0,
          "min": -40.0,
          "query": "did:4001",
          "target": 18,
          "unit": "C"
        },
        {
          "decode": "s16_div100",
          "id": "eng_torque",
          "label": "Engine torque (signed)",
          "max": 327.67,
          "min": -327.68,
          "query": "did:4500",
          "target": 18,
          "unit": "Nm"
        },
        {
          "decode": "u8_div100",
          "id": "lambda_1",
          "label": "Lambda bank 1",
          "max": 1.5,
          "min": 0.5,
          "query": "did:400B",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_div100",
          "id": "inj_time",
          "label": "Injection time (per cylinder) [needs verification, UDS only]",
          "max": 2.55,
          "min": 0.0,
          "query": "did:4363",
          "target": 18,
          "unit": "ms"
        },
        {
          "decode": "u8_enum",
          "id": "gear",
          "label": "Gear position (EGS) [UDS only]",
          "max": 15.0,
          "min": 0.0,
          "query": "did:DA0A",
          "target": 24,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "engine_state",
          "label": "Engine state (DME) [needs verification, UDS only]",
          "max": 5.0,
          "min": 0.0,
          "query": "did:4004",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "knock_detect",
          "label": "Knock detection (DME) [needs verification, UDS only]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:401F",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "s16_div100",
          "id": "ltft_bank1",
          "label": "Long-term fuel trim, bank 1 (DME) [needs verification, UDS only]",
          "max": 25.0,
          "min": -25.0,
          "query": "did:1201",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "s16_div100",
          "id": "idle_adaptation",
          "label": "Idle adaptation (DME) [needs verification, UDS only]",
          "max": 25.0,
          "min": -25.0,
          "query": "did:1202",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "u16_fiftieths",
          "id": "inj_duty",
          "label": "Injector duty cycle (DME) [needs verification, UDS only]",
          "max": 100.0,
          "min": 0.0,
          "query": "did:4401",
          "target": 18,
          "unit": "%"
        }
      ]
    },
    {
      "id": "n57",
      "label": "N57 3.0 turbo diesel I6 (DDE, F-series) [community, needs verification]",
      "param": [
        {
          "decode": "u16_quarter",
          "id": "rpm",
          "label": "Engine speed",
          "max": 5500.0,
          "min": 0.0,
          "query": "obd:0C",
          "target": 18,
          "unit": "rpm"
        },
        {
          "decode": "temp_u8",
          "id": "coolant",
          "label": "Coolant temp",
          "max": 150.0,
          "min": -40.0,
          "query": "obd:05",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "oil",
          "label": "Oil temp [UNVERIFIED placeholder]",
          "max": 160.0,
          "min": -40.0,
          "query": "local:10",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "iat",
          "label": "Intake air temp (post-IC)",
          "max": 100.0,
          "min": -40.0,
          "query": "obd:0F",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u8",
          "id": "map",
          "label": "Manifold pressure (abs)",
          "max": 255.0,
          "min": 0.0,
          "query": "obd:0B",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u8",
          "id": "baro",
          "label": "Barometric pressure",
          "max": 110.0,
          "min": 60.0,
          "query": "obd:33",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "percent_a",
          "id": "load",
          "label": "Engine load",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:04",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "percent_a",
          "id": "throttle",
          "label": "Throttle position (EGR/shutdown valve)",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:11",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "u8",
          "id": "speed",
          "label": "Vehicle speed",
          "max": 300.0,
          "min": 0.0,
          "query": "obd:0D",
          "target": 18,
          "unit": "km/h"
        },
        {
          "decode": "u16_milli",
          "id": "volt",
          "label": "Module voltage",
          "max": 16.0,
          "min": 8.0,
          "query": "obd:42",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "temp_u8",
          "id": "ambient",
          "label": "Ambient temp",
          "max": 60.0,
          "min": -40.0,
          "query": "obd:46",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u16_tenths",
          "id": "battery_v",
          "label": "Battery voltage (DDE) [needs verification]",
          "max": 16.0,
          "min": 8.0,
          "query": "did:4002",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "u16_tenths",
          "id": "hpfp_rail",
          "label": "Rail pressure (common rail) [needs verification]",
          "max": 250.0,
          "min": 0.0,
          "query": "did:44F0",
          "target": 18,
          "unit": "MPa"
        },
        {
          "decode": "u16_tenths",
          "id": "boost_cmd",
          "label": "Boost command (relative) [needs verification]",
          "max": 300.0,
          "min": -100.0,
          "query": "did:4367",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u16_div100",
          "id": "maf",
          "label": "Mass air flow [needs verification]",
          "max": 655.35,
          "min": 0.0,
          "query": "did:4077",
          "target": 18,
          "unit": "kg/h"
        },
        {
          "decode": "u16_div100",
          "id": "ambient_pres",
          "label": "Ambient pressure (DDE) [needs verification]",
          "max": 110.0,
          "min": 60.0,
          "query": "did:4003",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "s16_div4",
          "id": "dme_temp",
          "label": "DDE temperature (signed, 0.25C resolution) [needs verification]",
          "max": 150.0,
          "min": -40.0,
          "query": "did:4001",
          "target": 18,
          "unit": "C"
        },
        {
          "decode": "s16_div100",
          "id": "eng_torque",
          "label": "Engine torque (signed) [needs verification]",
          "max": 327.67,
          "min": -327.68,
          "query": "did:4500",
          "target": 18,
          "unit": "Nm"
        },
        {
          "decode": "u8_div100",
          "id": "lambda_1",
          "label": "Lambda bank 1 [needs verification]",
          "max": 1.5,
          "min": 0.5,
          "query": "did:400B",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_div100",
          "id": "inj_time",
          "label": "Injection time (per cylinder) [needs verification, UDS only]",
          "max": 2.55,
          "min": 0.0,
          "query": "did:4363",
          "target": 18,
          "unit": "ms"
        },
        {
          "decode": "u8_enum",
          "id": "gear",
          "label": "Gear position (EGS) [needs verification, UDS only]",
          "max": 15.0,
          "min": 0.0,
          "query": "did:DA0A",
          "target": 24,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "engine_state",
          "label": "Engine state (DDE) [needs verification, UDS only]",
          "max": 5.0,
          "min": 0.0,
          "query": "did:4004",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "glow_plug",
          "label": "Glow plug state (DDE) [needs verification, UDS only]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:4036",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "dpf_state",
          "label": "DPF state (DDE) [needs verification, UDS only]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:4038",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "dpf_regen",
          "label": "DPF regeneration (DDE) [needs verification, UDS only]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:4039",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "dpf_ash",
          "label": "DPF ash load (DDE) [needs verification, UDS only]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:403A",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "dpf_soot",
          "label": "DPF soot load (DDE) [needs verification, UDS only]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:403B",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "nox_sensor",
          "label": "NOx sensor state (DDE) [needs verification, UDS only]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:403E",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "exhaust_temp",
          "label": "Exhaust temp sensor (DDE) [needs verification, UDS only]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:4042",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "egr_cooler",
          "label": "EGR cooler efficiency (DDE) [needs verification, UDS only]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:4047",
          "target": 18,
          "unit": ""
        }
      ]
    },
    {
      "id": "n62",
      "label": "N62 4.0–4.8 NA V8 (ME9.2) [community]",
      "param": [
        {
          "decode": "u16_quarter",
          "id": "rpm",
          "label": "Engine speed",
          "max": 6800.0,
          "min": 0.0,
          "query": "obd:0C",
          "target": 18,
          "unit": "rpm"
        },
        {
          "decode": "temp_u8",
          "id": "coolant",
          "label": "Coolant temp",
          "max": 150.0,
          "min": -40.0,
          "query": "obd:05",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "oil",
          "label": "Oil temp",
          "max": 160.0,
          "min": -40.0,
          "query": "obd:5C",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "iat",
          "label": "Intake air temp",
          "max": 80.0,
          "min": -40.0,
          "query": "obd:0F",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "percent_a",
          "id": "load",
          "label": "Engine load",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:04",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "percent_a",
          "id": "throttle",
          "label": "Throttle position",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:11",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "u8",
          "id": "map",
          "label": "Manifold pressure",
          "max": 120.0,
          "min": 0.0,
          "query": "obd:0B",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u8",
          "id": "speed",
          "label": "Vehicle speed",
          "max": 300.0,
          "min": 0.0,
          "query": "obd:0D",
          "target": 18,
          "unit": "km/h"
        },
        {
          "decode": "u16_milli",
          "id": "volt",
          "label": "Module voltage",
          "max": 16.0,
          "min": 8.0,
          "query": "obd:42",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "temp_u8",
          "id": "ambient",
          "label": "Ambient temp",
          "max": 60.0,
          "min": -40.0,
          "query": "obd:46",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u16_fiftieths",
          "id": "fuel_rate_lh",
          "label": "Engine fuel rate (L/h)",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:5E",
          "target": 18,
          "unit": "L/h"
        },
        {
          "decode": "u32_be",
          "id": "engine_runtime",
          "label": "Engine runtime",
          "max": 4294967295.0,
          "min": 0.0,
          "query": "obd:5F",
          "target": 18,
          "unit": "s"
        },
        {
          "decode": "u16_half",
          "id": "fuel_rate_gs",
          "label": "Engine fuel rate (g/s)",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:62",
          "target": 18,
          "unit": "g/s"
        }
      ]
    },
    {
      "id": "s55",
      "label": "S55 3.0 twin-turbo I6 (F80/F82/F87 M) [community, needs verification]",
      "param": [
        {
          "decode": "u16_quarter",
          "id": "rpm",
          "label": "Engine speed",
          "max": 7500.0,
          "min": 0.0,
          "query": "obd:0C",
          "target": 18,
          "unit": "rpm"
        },
        {
          "decode": "temp_u8",
          "id": "coolant",
          "label": "Coolant temp",
          "max": 150.0,
          "min": -40.0,
          "query": "obd:05",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "oil",
          "label": "Oil temp [UNVERIFIED placeholder]",
          "max": 160.0,
          "min": -40.0,
          "query": "local:10",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "iat",
          "label": "Intake air temp (post-IC)",
          "max": 100.0,
          "min": -40.0,
          "query": "obd:0F",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u8",
          "id": "map",
          "label": "Manifold pressure (abs)",
          "max": 255.0,
          "min": 0.0,
          "query": "obd:0B",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u8",
          "id": "baro",
          "label": "Barometric pressure",
          "max": 110.0,
          "min": 60.0,
          "query": "obd:33",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "percent_a",
          "id": "load",
          "label": "Engine load",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:04",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "percent_a",
          "id": "throttle",
          "label": "Throttle position",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:11",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "u8",
          "id": "speed",
          "label": "Vehicle speed",
          "max": 300.0,
          "min": 0.0,
          "query": "obd:0D",
          "target": 18,
          "unit": "km/h"
        },
        {
          "decode": "u16_milli",
          "id": "volt",
          "label": "Module voltage",
          "max": 16.0,
          "min": 8.0,
          "query": "obd:42",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "temp_u8",
          "id": "ambient",
          "label": "Ambient temp",
          "max": 60.0,
          "min": -40.0,
          "query": "obd:46",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u16_tenths",
          "id": "battery_v",
          "label": "Battery voltage (DME) [needs verification]",
          "max": 16.0,
          "min": 8.0,
          "query": "did:4002",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "u16_tenths",
          "id": "hpfp_rail",
          "label": "HPFP rail pressure [needs verification]",
          "max": 30.0,
          "min": 0.0,
          "query": "did:44F0",
          "target": 18,
          "unit": "MPa"
        },
        {
          "decode": "u16_tenths",
          "id": "boost_cmd",
          "label": "Boost command (relative) [needs verification]",
          "max": 300.0,
          "min": -100.0,
          "query": "did:4367",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u16_div100",
          "id": "maf",
          "label": "Mass air flow [needs verification]",
          "max": 655.35,
          "min": 0.0,
          "query": "did:4077",
          "target": 18,
          "unit": "kg/h"
        },
        {
          "decode": "u16_div100",
          "id": "ambient_pres",
          "label": "Ambient pressure (DME) [needs verification]",
          "max": 110.0,
          "min": 60.0,
          "query": "did:4003",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "s16_div4",
          "id": "dme_temp",
          "label": "DME temperature (signed, 0.25C resolution) [needs verification]",
          "max": 150.0,
          "min": -40.0,
          "query": "did:4001",
          "target": 18,
          "unit": "C"
        },
        {
          "decode": "s16_div100",
          "id": "eng_torque",
          "label": "Engine torque (signed) [needs verification]",
          "max": 327.67,
          "min": -327.68,
          "query": "did:4500",
          "target": 18,
          "unit": "Nm"
        },
        {
          "decode": "u8_div100",
          "id": "lambda_1",
          "label": "Lambda bank 1 [needs verification]",
          "max": 1.5,
          "min": 0.5,
          "query": "did:400B",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_div100",
          "id": "inj_time",
          "label": "Injection time (per cylinder) [needs verification, UDS only]",
          "max": 2.55,
          "min": 0.0,
          "query": "did:4363",
          "target": 18,
          "unit": "ms"
        },
        {
          "decode": "u8_enum",
          "id": "gear",
          "label": "Gear position (EGS) [needs verification, UDS only]",
          "max": 15.0,
          "min": 0.0,
          "query": "did:DA0A",
          "target": 24,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "engine_state",
          "label": "Engine state (DME) [needs verification, UDS only]",
          "max": 5.0,
          "min": 0.0,
          "query": "did:4004",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "knock_detect",
          "label": "Knock detection (DME) [needs verification, UDS only]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:401F",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "s16_div100",
          "id": "ltft_bank1",
          "label": "Long-term fuel trim, bank 1 (DME) [needs verification, UDS only]",
          "max": 25.0,
          "min": -25.0,
          "query": "did:1201",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "s16_div100",
          "id": "idle_adaptation",
          "label": "Idle adaptation (DME) [needs verification, UDS only]",
          "max": 25.0,
          "min": -25.0,
          "query": "did:1202",
          "target": 18,
          "unit": "%"
        }
      ]
    },
    {
      "id": "s58",
      "label": "S58 3.0 twin-turbo I6 (G80/G82/F97/F98 M) [community, needs verification]",
      "param": [
        {
          "decode": "u16_quarter",
          "id": "rpm",
          "label": "Engine speed",
          "max": 7500.0,
          "min": 0.0,
          "query": "obd:0C",
          "target": 18,
          "unit": "rpm"
        },
        {
          "decode": "temp_u8",
          "id": "coolant",
          "label": "Coolant temp",
          "max": 150.0,
          "min": -40.0,
          "query": "obd:05",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "oil",
          "label": "Oil temp [UNVERIFIED placeholder]",
          "max": 160.0,
          "min": -40.0,
          "query": "local:10",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "temp_u8",
          "id": "iat",
          "label": "Intake air temp (post-IC)",
          "max": 100.0,
          "min": -40.0,
          "query": "obd:0F",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u8",
          "id": "map",
          "label": "Manifold pressure (abs)",
          "max": 255.0,
          "min": 0.0,
          "query": "obd:0B",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u8",
          "id": "baro",
          "label": "Barometric pressure",
          "max": 110.0,
          "min": 60.0,
          "query": "obd:33",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "percent_a",
          "id": "load",
          "label": "Engine load",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:04",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "percent_a",
          "id": "throttle",
          "label": "Throttle position",
          "max": 100.0,
          "min": 0.0,
          "query": "obd:11",
          "target": 18,
          "unit": "%"
        },
        {
          "decode": "u8",
          "id": "speed",
          "label": "Vehicle speed",
          "max": 300.0,
          "min": 0.0,
          "query": "obd:0D",
          "target": 18,
          "unit": "km/h"
        },
        {
          "decode": "u16_milli",
          "id": "volt",
          "label": "Module voltage",
          "max": 16.0,
          "min": 8.0,
          "query": "obd:42",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "temp_u8",
          "id": "ambient",
          "label": "Ambient temp",
          "max": 60.0,
          "min": -40.0,
          "query": "obd:46",
          "target": 18,
          "unit": "°C"
        },
        {
          "decode": "u16_tenths",
          "id": "battery_v",
          "label": "Battery voltage (DME) [needs verification]",
          "max": 16.0,
          "min": 8.0,
          "query": "did:4002",
          "target": 18,
          "unit": "V"
        },
        {
          "decode": "u16_tenths",
          "id": "hpfp_rail",
          "label": "HPFP rail pressure [needs verification]",
          "max": 30.0,
          "min": 0.0,
          "query": "did:44F0",
          "target": 18,
          "unit": "MPa"
        },
        {
          "decode": "u16_tenths",
          "id": "boost_cmd",
          "label": "Boost command (relative) [needs verification]",
          "max": 300.0,
          "min": -100.0,
          "query": "did:4367",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "u16_div100",
          "id": "maf",
          "label": "Mass air flow [needs verification]",
          "max": 655.35,
          "min": 0.0,
          "query": "did:4077",
          "target": 18,
          "unit": "kg/h"
        },
        {
          "decode": "u16_div100",
          "id": "ambient_pres",
          "label": "Ambient pressure (DME) [needs verification]",
          "max": 110.0,
          "min": 60.0,
          "query": "did:4003",
          "target": 18,
          "unit": "kPa"
        },
        {
          "decode": "s16_div4",
          "id": "dme_temp",
          "label": "DME temperature (signed, 0.25C resolution) [needs verification]",
          "max": 150.0,
          "min": -40.0,
          "query": "did:4001",
          "target": 18,
          "unit": "C"
        },
        {
          "decode": "s16_div100",
          "id": "eng_torque",
          "label": "Engine torque (signed) [needs verification]",
          "max": 327.67,
          "min": -327.68,
          "query": "did:4500",
          "target": 18,
          "unit": "Nm"
        },
        {
          "decode": "u8_div100",
          "id": "lambda_1",
          "label": "Lambda bank 1 [needs verification]",
          "max": 1.5,
          "min": 0.5,
          "query": "did:400B",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_div100",
          "id": "inj_time",
          "label": "Injection time (per cylinder) [needs verification, UDS only]",
          "max": 2.55,
          "min": 0.0,
          "query": "did:4363",
          "target": 18,
          "unit": "ms"
        },
        {
          "decode": "u8_enum",
          "id": "gear",
          "label": "Gear position (EGS) [needs verification, UDS only]",
          "max": 15.0,
          "min": 0.0,
          "query": "did:DA0A",
          "target": 24,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "engine_state",
          "label": "Engine state (DME) [needs verification, UDS only]",
          "max": 5.0,
          "min": 0.0,
          "query": "did:4004",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "knock_detect",
          "label": "Knock detection (DME) [needs verification, UDS only]",
          "max": 3.0,
          "min": 0.0,
          "query": "did:401F",
          "target": 18,
          "unit": ""
        }
      ]
    },
    {
      "id": "test_plugin",
      "label": "Test Plugin Profile [community]",
      "param": [
        {
          "decode": "u8_enum",
          "id": "test_gear",
          "label": "Test Gear Position",
          "max": 15.0,
          "min": 0.0,
          "query": "did:DA0A",
          "target": 24,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "test_engine_state",
          "label": "Test Engine State",
          "max": 5.0,
          "min": 0.0,
          "query": "did:4004",
          "target": 18,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "test_gear",
          "label": "Test Gear Position",
          "max": 15.0,
          "min": 0.0,
          "query": "did:DA0A",
          "target": 24,
          "unit": ""
        },
        {
          "decode": "u8_enum",
          "id": "test_engine_state",
          "label": "Test Engine State",
          "max": 5.0,
          "min": 0.0,
          "query": "did:4004",
          "target": 18,
          "unit": ""
        }
      ]
    }
  ],
  "source": "community/profiles/*.toml"
};
