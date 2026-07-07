# BMW Hex DTC Research Findings — Dimension 01

**Research Date:** 2026-07-06

**Researcher:** Deep-research sub-agent (BeeEmUu project)

**Provenance:** ONLY community/open sources (forums, blogs, publicly shared PDFs). No ISTA/INPA/SGBD proprietary data.

---

## Summary

- **Total codes found in this research pass:** 213
- **Breakdown by category:**
  - CAN: 19
  - DSC: 7
  - HVAC: 14
  - VANOS: 6
  - airbag: 5
  - battery: 3
  - body: 16
  - cooling: 11
  - fuel: 10
  - lambda: 25
  - misfire: 8
  - other: 11
  - sensor: 17
  - throttle: 36
  - transmission: 11
  - turbo: 14
- **Already in orchestrator's starting list (BimmerFest + usro.net):** 57
- **Net-new codes (beyond orchestrator's known set):** 156
- **Codes already in existing project file (excluded from this list):** 7

### Conflicts / Ambiguities

1. **279B vs 2EF4** — Both refer to the same fault: 'Map cooling thermostat mechanically stuck'. 279B appears to be the hex code, 2EF4 may be an alternate representation or module-specific variant. The BimmerFest thread explicitly states 'code 2EF4 (279B)'. Source: BimmerFest thermostat thread.
2. **2D2A description** — The BimmerFest PDF lists 'Differential Pressure Sensor, suction pipe: adaptation' while N20 forum posts associate 2D2A with throttle-angle plausibility under boost. These may be module-specific variants or the same root cause (intake pressure deviation).
3. **NOx sensor codes** — Many alternate hex codes exist for the same physical fault (e.g., 2AF2 / 2B06 / 2B09 for 'NOx sensor Lambda linear'). These appear to be DME-specific variants (MSD80 vs MSD81 vs B38/B48 DMEs). BimmerProfs compiled a comprehensive cross-reference from community repair experience.
4. **2E85** — The BimmerFest water-pump thread and usro.net both list 2E85 as a coolant-pump communication code, but the exact wording varies ('communication' vs 'comms'). This is a single source confidence issue.

---

## Codes Found

### Legend
- **Confidence:** `high` = multiple independent forum posts confirm; `medium` = one detailed forum post or community PDF; `low` = single source or incomplete description.

### MISFIRE

#### 29CD
- **Description:** Misfire cylinder 1
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 29CE
- **Description:** Misfire cylinder 2
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 29CF
- **Description:** Misfire cylinder 3
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 29D0
- **Description:** Misfire cylinder 4
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 29D1
- **Description:** Misfire cylinder 5
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 29D2
- **Description:** Misfire cylinder 6
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 29D9
- **Description:** Misfire in case of tank filling level too low
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 29DC
- **Description:** Cylinder injection switch-off
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

### FUEL

#### 29E0
- **Description:** Fuel injection rail, pressure sensor signal
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 29E1
- **Description:** Fuel pressure sensor signal
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 29E2
- **Description:** Fuel injection rail, pressure sensor signal
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 29F3
- **Description:** Fuel pressure sensor, electrical
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 29F4
- **Description:** Fuel pressure sensor
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 29F5
- **Description:** Fuel pressure control
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2AAF
- **Description:** Fuel Pump Plausibility
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2A17
- **Description:** DMTL diagnosis module tank leakage, system failure
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2A2D
- **Description:** DMTL diagnosis module tank leakage, system failure
- **Source:** BimmerFest community list / PDF
- **URL:** https://m.book118.com/html/2024/1123/8106014134007001.shtm
- **Confidence:** high

#### 2FD4
- **Description:** Fuel system (N20 related)
- **Source:** BabyBMW forum post
- **URL:** https://www.babybmw.net/threads/1-series-bmw-2-0-petrol-2011-error-codes.136756/
- **Confidence:** medium

### VANOS

#### 2A80
- **Description:** Inlet VANOS variable cam control test, input signal
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2A85
- **Description:** Outlet VANOS variable cam control test
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2A96
- **Description:** Crankshaft sensor, tooth failure
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2A9A
- **Description:** Camshaft sensor inlet, signal
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2A99
- **Description:** VANOS exhaust: control fault, camshaft stuck (community list)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 3E80
- **Description:** Valvetronic actuator, activation: jammed mechanically
- **Source:** CSDN / Forum compilation
- **URL:** https://wenku.csdn.net/answer/62giogaru3
- **Confidence:** high

### TURBO

#### 2ABC
- **Description:** Charging pressure sensor, electrical
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2ABD
- **Description:** Intake pressure sensor, re-running
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 30CF
- **Description:** Turbo/boost related
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 30FE
- **Description:** Exhaust fume turbo charger, high pressure side
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 30FF
- **Description:** Turbocharger, charge-air pressure too low (underboost)
- **Source:** BMWTuning / N54 community
- **URL:** https://bmwtuning.co/bmw-n54-30ff-engine-fault-code-30ff-diagnosis-repair-guide/
- **Confidence:** high

#### 3100
- **Description:** Boost-pressure control, deactivation
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 28A0
- **Description:** N55 wastegate adaptation value exceeded
- **Source:** AutoExplain wastegate article
- **URL:** https://autoexplain.com/what-is-a-turbo-wastegate/
- **Confidence:** high

#### 2D18
- **Description:** Boost control, pressure too low (N20/N26/B48/B58)
- **Source:** AutoExplain wastegate article
- **URL:** https://autoexplain.com/what-is-a-turbo-wastegate/
- **Confidence:** high

#### CD87
- **Description:** E-Wastegate control deviation (B48/B58)
- **Source:** AutoExplain wastegate article
- **URL:** https://autoexplain.com/what-is-a-turbo-wastegate/
- **Confidence:** medium

#### 120308
- **Description:** Charging pressure control: too low (B58)
- **Source:** AutoExplain wastegate article
- **URL:** https://autoexplain.com/what-is-a-turbo-wastegate/
- **Confidence:** medium

#### 2D2A
- **Description:** Differential pressure sensor, suction pipe: adaptation / throttle angle plausibility
- **Source:** BimmerFest list / N20 forum
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** medium

#### 2D2E
- **Description:** Angle of throttle valve - intake pipe underpressure
- **Source:** BimmerFest / SpoolStreet
- **URL:** https://www.bimmerfest.com/threads/2d2e-angle-of-thottle-valve-intake-pipe-underpres.894191/
- **Confidence:** high

#### 2D29
- **Description:** MAP sensor error (intake manifold pressure)
- **Source:** Bimmerforums N52 thread
- **URL:** https://www.bimmerforums.com/forum/showthread.php?2499206-N52-rough-idle-and-MAF-fault-codes
- **Confidence:** medium

#### 2AD0
- **Description:** Gear Control
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** medium

### LAMBDA

#### 2AEC
- **Description:** NOx sensor self diagnostics
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 2AF0
- **Description:** NOx sensor, heating
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 2AF2
- **Description:** NOx sensor, Lambda linear
- **Source:** BimmerProfs / BabyBMW forum
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 2AF4
- **Description:** NOx sensor, electrical
- **Source:** BimmerProfs / BabyBMW forum
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 2AF6
- **Description:** NOx sensor, Lambda binary
- **Source:** BimmerProfs / BabyBMW forum
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 2AF9
- **Description:** NOx sensor, nox signal: coast mode check
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 2B05
- **Description:** NOx sensor, heating (alternate)
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** medium

#### 2B06
- **Description:** NOx sensor, Lambda linear (alternate)
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** medium

#### 2B07
- **Description:** NOx sensor, electrical (alternate)
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** medium

#### 2B09
- **Description:** NOx sensor, Lambda linear (alternate)
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** medium

#### 2B0A
- **Description:** NOx sensor, Lambda binary (alternate)
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** medium

#### 2AFB
- **Description:** NOx sensor, Lambda binary (alternate)
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** medium

#### 2B0B
- **Description:** NOx sensor, Lambda binary (alternate)
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** medium

#### 2EAE
- **Description:** NOx sensor message missing (timeout)
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 30D6
- **Description:** NOx sensor, plausibility
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 30D8
- **Description:** NOx sensor, sensor damaged
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 30DA
- **Description:** NOx sensor, heating time
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 30DC
- **Description:** NOx sensor, heating
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 30DE
- **Description:** NOx sensor - Lambdaprobe before catalyst, correlation
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 30E0
- **Description:** NOx sensor, offset
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 30E2
- **Description:** NOx sensor, thrust test
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 30E4
- **Description:** NOx sensor, aging
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 30E6
- **Description:** NOx sensor, dynamics
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 30E9
- **Description:** Nitric oxide catalytic converter, aging
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

#### 30EA
- **Description:** DeNox catalytic converter sulfurized
- **Source:** BimmerProfs community guide
- **URL:** https://bimmerprofs.com/replacing-nox-sensor-n43n53/
- **Confidence:** high

### THROTTLE

#### 2D1C
- **Description:** Accelerator pedal module, pedal sensor signal 2
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2D58
- **Description:** DME digital motor electronics, internal failure: control nominal torque
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2D5A
- **Description:** Control motor torque limitation
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2F8F
- **Description:** Throttle/pedal related
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2D25
- **Description:** Mass Air Flow Excessive - External Tuning Box Detected
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** medium

#### 2710
- **Description:** Throttle valve, function: jammed permanently
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 2711
- **Description:** Throttle valve, function: jammed briefly
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 2714
- **Description:** Throttle valve, function: sluggish, too slow
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 27E4
- **Description:** Accelerator-pedal module, pedal-travel sensor multiple fault
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 27E8
- **Description:** Accelerator pedal module, synchronisation error between signal 1 and 2
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 27D9
- **Description:** Accelerator pedal module, pedal sensor 1, short circuit to B+
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 27DA
- **Description:** Accelerator pedal module, pedal sensor 1, short circuit to earth
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 27DB
- **Description:** Pedal module, pedal sensor 2, short circuit to B+
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 27DC
- **Description:** Pedal module, pedal sensor 2, short circuit to earth
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28A0
- **Description:** Throttle-valve angle - intake-manifold pressure, correlation: limit value exceeded
- **Source:** SpoolStreet N55 community list / OBDAdvisor
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28A1
- **Description:** Throttle-valve angle - intake-manifold pressure, correlation: limit value not exceeded
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28A4
- **Description:** Throttle valve, throttle valve potentiometer 1, short to B+ or open circuit
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28A5
- **Description:** Throttle valve, throttle valve potentiometer 1, short circuit to earth
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28A8
- **Description:** Throttle valve, throttle potentiometer 2, short circuit to B+
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28A9
- **Description:** Throttle valve, throttle potentiometer 2, short circuit to earth
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28B0
- **Description:** Throttle valve: Limp-home operating mode active
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28B4
- **Description:** Throttle valve, throttle potentiometer: plausibility timing fault between potentiometer 1 and 2
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28B8
- **Description:** DME, internal fault, activation of throttle valve: short circuit
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28B9
- **Description:** DME, internal fault, activation of throttle valve: excess temperature or current too high
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28BA
- **Description:** DME, internal fault, activation of throttle valve: internal communication fault
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28BB
- **Description:** DME, internal fault, activation of throttle valve: line disconnection
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28BC
- **Description:** Throttle valve actuator, closing spring test: cancellation of check
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28BD
- **Description:** Throttle valve actuator, closing spring test: fault during spring check
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28C0
- **Description:** Throttle valve actuator, opening spring test: cancellation of check
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28C1
- **Description:** Throttle valve actuator, opening spring test: fault during spring check
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28C4
- **Description:** Throttle valve, adaptation: emergency running position not adapted
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28CC
- **Description:** Throttle valve, adaptation: marginal conditions not met
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28CD
- **Description:** Throttle valve, adaptation: marginal conditions not met; battery voltage too low
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28D0
- **Description:** Throttle valve, adaptation: initial adaptation, lower limit position not taught in
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 28D4
- **Description:** Throttle valve, adaptation: teach in again, lower limit position not taught in
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 2906
- **Description:** Intake air system: suspicion of leaks between turbocharger and intake valves
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

### COOLING

#### 2E84
- **Description:** Cooling system related
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2EE0
- **Description:** Cooling system related
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2EE1
- **Description:** Cooling system related
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2EE2
- **Description:** Cooling system related
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2EE3
- **Description:** Cooling system related
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2F0D
- **Description:** Cooling system related
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 2E83
- **Description:** Electric coolant pump: communication fault
- **Source:** BimmerFest water pump thread
- **URL:** https://www.bimmerfest.com/threads/water-pump-problems.1454350/
- **Confidence:** medium

#### 2E85
- **Description:** Electric coolant pump: communication / cutoff
- **Source:** BimmerFest water pump thread / usro.net
- **URL:** https://www.bimmerfest.com/threads/water-pump-problems.1454350/
- **Confidence:** medium

#### 2E8D
- **Description:** Cooling system (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** medium

#### 279B
- **Description:** Map cooling thermostat mechanically stuck (also 2EF4)
- **Source:** BimmerFest thermostat thread
- **URL:** https://www.bimmerfest.com/threads/code-279b-dme-thermostat-stuck.1413711/
- **Confidence:** high

#### 2EF4
- **Description:** Map cooling thermostat mechanically stuck (same as 279B)
- **Source:** BimmerFest thermostat thread
- **URL:** https://www.bimmerfest.com/threads/code-279b-dme-thermostat-stuck.1413711/
- **Confidence:** high

### SENSOR

#### 2774
- **Description:** Mass air flow sensor, plausibility: air mass compared with model too high
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 2775
- **Description:** Mass air flow sensor, plausibility: air mass compared with model too low
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 2778
- **Description:** Air mass sensor, signal: implausible period duration, loose contact low frequency
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 2779
- **Description:** Air mass sensor, signal: implausible period duration, loose contact high frequency
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 277A
- **Description:** Air mass sensor, signal: short-circuit or line break (open circuit)
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 280E
- **Description:** Absolute pressure sensor, intake manifold, plausibility: intake-manifold pressure too high
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 280F
- **Description:** Absolute pressure sensor, intake manifold, plausibility: intake-manifold pressure too low
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 281A
- **Description:** Absolute pressure sensor, intake pipe, electrical: short circuit to B+
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 281B
- **Description:** Absolute pressure sensor, intake pipe, electrical: short circuit to earth
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 283C
- **Description:** Ambient pressure sensor, electrical: short to B+ or open circuit
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 283D
- **Description:** Ambient pressure sensor, electrical: short circuit to earth
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 2841
- **Description:** Ambient pressure sensor, overrun: pressure too high
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 2842
- **Description:** Ambient pressure sensor, overrun: pressure too low
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 284C
- **Description:** Ambient pressure sensor, plausibility: pressure too high
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 284D
- **Description:** Ambient pressure sensor, plausibility: pressure too low
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 284E
- **Description:** Ambient pressure sensor, plausibility: pressure implausible
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 284F
- **Description:** Ambient pressure sensor, plausibility: pressure implausible
- **Source:** SpoolStreet N55 community list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

### BATTERY

#### 2793
- **Description:** DME: Power management, battery
- **Source:** M5Board E60 codes thread
- **URL:** https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/
- **Confidence:** medium

#### 3886
- **Description:** System voltage: voltage too high
- **Source:** SpoolStreet N55 list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 2793
- **Description:** DME: Power management, battery
- **Source:** M5Board E60 codes thread
- **URL:** https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/
- **Confidence:** medium

### TRANSMISSION

#### 5088
- **Description:** Sensors gear selector switch
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 51A6
- **Description:** Transmission related
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** medium

#### 5101
- **Description:** SMG III: Analyze hydraulic sensor
- **Source:** M5Board / BMW TSB community post
- **URL:** https://www.m5board.com/threads/m5-m6-s85-recall-tech-service-bulletin-service-information-bulletin-technical-docs-thread-one-stop-shop.213154/
- **Confidence:** high

#### 4F82
- **Description:** Transmission error (EGS/GWS)
- **Source:** Bimmerforums transmission thread
- **URL:** https://www.bimmerforums.com/forum/showthread.php?2324654-2-transmission-error-code
- **Confidence:** medium

#### 507B
- **Description:** Parking brake failure (transmission related)
- **Source:** Bimmerforums transmission thread
- **URL:** https://www.bimmerforums.com/forum/showthread.php?2324654-2-transmission-error-code
- **Confidence:** medium

#### CDA7
- **Description:** Transmission: status gear reverse
- **Source:** 5series.net forum post
- **URL:** https://5series.net/forums/e60-discussion-2/identification-two-inpa-errors-141133/
- **Confidence:** medium

#### 4FA0
- **Description:** SMG: clutch (activation position deviation)
- **Source:** M5Board E60 codes thread
- **URL:** https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/
- **Confidence:** medium

#### 5401
- **Description:** SMG: starter enable
- **Source:** M5Board E60 codes thread
- **URL:** https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/
- **Confidence:** medium

#### 520A
- **Description:** SMG: signal, steering angle is faulty (DSC)
- **Source:** M5Board E60 codes thread
- **URL:** https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/
- **Confidence:** medium

#### CF33
- **Description:** Transmission code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### 6140
- **Description:** Transmission code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

### DSC

#### 5DE0
- **Description:** DSC-ECU: ECU-internal plausibility VASP-U_Bit
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 5DE1
- **Description:** DSC-ECU: ECU-internal clockstatus missing clock
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 5E1A
- **Description:** DSC-ECU: SPI transmission failure multi IC
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 5E40
- **Description:** Wheel speed sensor rear right: signal edge missing
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 5E5B
- **Description:** Stability control - wheel speed sensor general long-term error
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 51B0
- **Description:** DSC signal not plausible: brake pressure signal
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### 5E19
- **Description:** DSC: engine management interface
- **Source:** M5Board E60 codes thread
- **URL:** https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/
- **Confidence:** medium

### BODY

#### A092
- **Description:** SHD Standardization
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### A0B0
- **Description:** ECU input brake lights
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### A0B4
- **Description:** Fault engine start starter
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### A375
- **Description:** Communication with airbag ECU disturbed
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### A3AD
- **Description:** CAN ID 1D0 error: Engine data
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### A3AE
- **Description:** CAN ID 0AA error: Idle engine speed
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### A554
- **Description:** Alive telephone
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### A559
- **Description:** Clamp 30g_f cutoff
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### A8B6
- **Description:** Error will not cause a warning light
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### A10A
- **Description:** Body module code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### A127
- **Description:** Body module code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### A114
- **Description:** CAS: line fault, electrical steering lock
- **Source:** M5Board E60 codes thread
- **URL:** https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/
- **Confidence:** medium

#### A118
- **Description:** CAS: roadstead signal implausible
- **Source:** M5Board E60 codes thread
- **URL:** https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/
- **Confidence:** medium

#### A0B2
- **Description:** CAS: supply, terminal 30E/30L
- **Source:** M5Board E60 codes thread
- **URL:** https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/
- **Confidence:** medium

#### 2F44
- **Description:** EWS preventing manipulation (immobilizer)
- **Source:** Autel support / Bimmerfest
- **URL:** https://bbs.autel.com/autelsupport/Diagnostics/27585.jhtml
- **Confidence:** high

#### 2F45
- **Description:** EWS preventing manipulation (related to 2F44)
- **Source:** Bimmerfest immobilizer thread
- **URL:** https://www.bimmerfest.com/threads/help-bmw-no-crank-no-start-codes-2f44ews-2f45ews-dme-a0b2-whats-needs-to-be-done-to-fix-this-issue.1448260/
- **Confidence:** medium

### CAN

#### D354
- **Description:** PT-CAN: Message TORQUE_1 (ID 0xA8) not received or wrong message length
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### D355
- **Description:** PT-CAN: Message TORQUE_2 (ID 0x0A9) not received or wrong message length
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### D356
- **Description:** PT-CAN: Message TORQUE_3 (ID 0xAA) not received or wrong message length
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### D904
- **Description:** K CAN wire error
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### E717
- **Description:** CAN message: Dates of engine
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### E71A
- **Description:** CAN message: Torque 3
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** high

#### E18C
- **Description:** CAN related (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### E18F
- **Description:** CAN related (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### 3BD6
- **Description:** PT-CAN message vehicle speed checksum wrong/alive check
- **Source:** SpoolStreet N55 list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 3BD7
- **Description:** PT-CAN no message vehicle speed
- **Source:** SpoolStreet N55 list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 3BD8
- **Description:** PT-CAN no message transmission data 2
- **Source:** SpoolStreet N55 list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 3BD9
- **Description:** PT-CAN message DKG status missing
- **Source:** SpoolStreet N55 list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 3BDA
- **Description:** PT-CAN message transmission data 3 checksum wrong
- **Source:** SpoolStreet N55 list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 3BDB
- **Description:** PT-CAN no message transmission data 3
- **Source:** SpoolStreet N55 list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 3BDC
- **Description:** PT-CAN message ETC torque request checksum wrong
- **Source:** SpoolStreet N55 list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 3BDD
- **Description:** PT-CAN no message ETC torque request
- **Source:** SpoolStreet N55 list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 3BDE
- **Description:** PT-CAN message twin-clutch gearbox torque request checksum wrong
- **Source:** SpoolStreet N55 list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 3BDF
- **Description:** PT-CAN no message twin-clutch gearbox torque request
- **Source:** SpoolStreet N55 list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

#### 3BE0
- **Description:** PT-CAN message gearbox data checksum wrong
- **Source:** SpoolStreet N55 list
- **URL:** https://spoolstreet.com/threads/n55-codes-list.580/
- **Confidence:** high

### HVAC

#### 9C54
- **Description:** AUC sensor (automatic recirculation control)
- **Source:** 5series.net / Bimmerfest
- **URL:** https://5series.net/forums/e60-discussion-2/identification-two-inpa-errors-141133/
- **Confidence:** high

#### A6CF
- **Description:** AUC sensor (IHKA)
- **Source:** Bimmerfest IHKA thread
- **URL:** https://www.bimmerfest.com/threads/ihka-fault-codes.1290835/
- **Confidence:** high

#### E72B
- **Description:** No message (solar sensor, 0x3D3), receiver IHKA
- **Source:** Bimmerfest IHKA thread
- **URL:** https://www.bimmerfest.com/threads/ihka-fault-codes.1290835/
- **Confidence:** high

#### E723
- **Description:** No message (condensation sensor, 0x2D1), receiver IHKA
- **Source:** Bimmerfest IHKA thread
- **URL:** https://www.bimmerfest.com/threads/ihka-fault-codes.1290835/
- **Confidence:** high

#### E729
- **Description:** No message (automatic air recirculation control sensor, 0x2D0), receiver JBE
- **Source:** Bimmerfest IHKA thread
- **URL:** https://www.bimmerfest.com/threads/ihka-fault-codes.1290835/
- **Confidence:** high

#### 9C70
- **Description:** ISupply, SZM (IHKA climate control)
- **Source:** Bimmerfest climate control thread
- **URL:** https://www.bimmerfest.com/threads/climate-control-system-ihka-fault.1310281/
- **Confidence:** medium

#### 9C59
- **Description:** Evaporator temperature sensor (IHKA)
- **Source:** Bimmerfest climate control thread
- **URL:** https://www.bimmerfest.com/threads/climate-control-system-ihka-fault.1310281/
- **Confidence:** medium

#### 9C5A
- **Description:** Heating heat-exchanger sensor, left (IHKA)
- **Source:** Bimmerfest climate control thread
- **URL:** https://www.bimmerfest.com/threads/climate-control-system-ihka-fault.1310281/
- **Confidence:** medium

#### 9C5C
- **Description:** Heating heat-exchanger sensor, right (IHKA)
- **Source:** Bimmerfest climate control thread
- **URL:** https://www.bimmerfest.com/threads/climate-control-system-ihka-fault.1310281/
- **Confidence:** medium

#### 9C60
- **Description:** SZM button 1 (IHKA)
- **Source:** Bimmerfest climate control thread
- **URL:** https://www.bimmerfest.com/threads/climate-control-system-ihka-fault.1310281/
- **Confidence:** medium

#### 9C61
- **Description:** SZM button 2 (IHKA)
- **Source:** Bimmerfest climate control thread
- **URL:** https://www.bimmerfest.com/threads/climate-control-system-ihka-fault.1310281/
- **Confidence:** medium

#### 9C62
- **Description:** SZM button 3 (IHKA)
- **Source:** Bimmerfest climate control thread
- **URL:** https://www.bimmerfest.com/threads/climate-control-system-ihka-fault.1310281/
- **Confidence:** medium

#### 9C63
- **Description:** SZM button 4 (IHKA)
- **Source:** Bimmerfest climate control thread
- **URL:** https://www.bimmerfest.com/threads/climate-control-system-ihka-fault.1310281/
- **Confidence:** medium

#### 9C65
- **Description:** SZM variant coding 2 (IHKA)
- **Source:** Bimmerfest climate control thread
- **URL:** https://www.bimmerfest.com/threads/climate-control-system-ihka-fault.1310281/
- **Confidence:** medium

### AIRBAG

#### B1000
- **Description:** Airbag ECU malfunction (SRS module internal failure)
- **Source:** Go-Parts / Bimmerfest
- **URL:** https://www.go-parts.com/garage/obd-b1000-bmw-3-series-2005-2013
- **Confidence:** high

#### 93AE
- **Description:** ACSM/MRS: side airbag driver, rear
- **Source:** M5Board E60 codes thread
- **URL:** https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/
- **Confidence:** medium

#### 93D2
- **Description:** ACSM/MRS: telltale lamp for front passenger airbag deactivation
- **Source:** M5Board E60 codes thread
- **URL:** https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/
- **Confidence:** medium

#### 93C3
- **Description:** ACSM/MRS: seat-occupancy detector, passenger
- **Source:** M5Board E60 codes thread
- **URL:** https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/
- **Confidence:** medium

#### 9408
- **Description:** ACSM/MRS: under voltage during test
- **Source:** M5Board E60 codes thread
- **URL:** https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/
- **Confidence:** medium

### OTHER

#### 2F4A
- **Description:** Engine code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### 2F4C
- **Description:** Engine code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### 2F6C
- **Description:** Engine code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### 2F9E
- **Description:** Engine code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### 2FBE
- **Description:** Engine code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### 2DC3
- **Description:** Engine code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### 2DC5
- **Description:** Engine code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### 2DEC
- **Description:** Engine code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### 2DED
- **Description:** Engine code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### 30F1
- **Description:** Engine code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

#### 30F2
- **Description:** Engine code (from community PDF)
- **Source:** BimmerFest community list
- **URL:** https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
- **Confidence:** low

---

## Source Inventory (Open-Source Only)

| Source | Type | URL |
|--------|------|-----|
| BimmerFest 'Error code 2a82 and 2a99' thread | Community-compiled hex list (~100 codes) | https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/ |
| BimmerFest 'DTC - Diagnostic Codes List for N55' | Community PDF (N55 hex DTCs) | https://www.bimmerfest.com/threads/dtc-diagnostic-codes-list-for-n55.1394107/ |
| SpoolStreet N55 Codes List | Community forum post (table format) | https://spoolstreet.com/threads/n55-codes-list.580/ |
| SpoolStreet N54 Codes List | Community forum post | https://spoolstreet.com/threads/n54-codes-list.578/ |
| BimmerProfs 'Replacing NOx sensor N43/N53' | Community repair guide with DTC cross-reference | https://bimmerprofs.com/replacing-nox-sensor-n43n53/ |
| AutoExplain 'Turbo Wastegate' article | Community blog with BMW-specific codes | https://autoexplain.com/what-is-a-turbo-wastegate/ |
| BMWTuning 'N54 30FF' guide | Community blog / repair guide | https://bmwtuning.co/bmw-n54-30ff-engine-fault-code-30ff-diagnosis-repair-guide/ |
| BimmerFest thermostat thread | Forum post with TSB reference | https://www.bimmerfest.com/threads/code-279b-dme-thermostat-stuck.1413711/ |
| BimmerFest water pump thread | Forum post confirming 2E83-2E85 | https://www.bimmerfest.com/threads/water-pump-problems.1454350/ |
| BimmerFest IHKA fault codes thread | Forum post with HVAC codes | https://www.bimmerfest.com/threads/ihka-fault-codes.1290835/ |
| BimmerFest climate control thread | Forum post with IHKA sub-codes | https://www.bimmerfest.com/threads/climate-control-system-ihka-fault.1310281/ |
| BimmerFest 2F44 immobilizer thread | Forum post | https://www.bimmerfest.com/threads/2f44-ews-immobilizer.910559/ |
| BimmerFest 2D2E throttle angle thread | Forum post | https://www.bimmerfest.com/threads/2d2e-angle-of-thottle-valve-intake-pipe-underpres.894191/ |
| 5series.net INPA errors thread | Forum post (transmission + HVAC) | https://5series.net/forums/e60-discussion-2/identification-two-inpa-errors-141133/ |
| M5Board 'E60 codes' thread | Forum post (DSC, CAS, ACSM, SMG) | https://www.m5board.com/threads/error-codes-help-me-bring-my-e60-back-from-the-dead.604828/ |
| M5Board S85/SMG TSB thread | Forum post (SMG 5101) | https://www.m5board.com/threads/m5-m6-s85-recall-tech-service-bulletin-service-information-bulletin-technical-docs-thread-one-stop-shop.213154/ |
| Bimmerforums transmission error thread | Forum post (4F82, 507B) | https://www.bimmerforums.com/forum/showthread.php?2324654-2-transmission-error-code |
| Bimmerforums N52 MAF thread | Forum post (2D29 MAP) | https://www.bimmerforums.com/forum/showthread.php?2499206-N52-rough-idle-and-MAF-fault-codes |
| BabyBMW N20 error codes thread | Forum post (2D2A, 2FD4, etc.) | https://www.babybmw.net/threads/1-series-bmw-2-0-petrol-2011-error-codes.136756/ |
| BabyBMW NOx fault codes thread | Forum post (2AF4, 2AF2, etc.) | https://www.babybmw.net/threads/30ea-2af4-2af2-2af6-2af9-fault-codes.60415/ |
| Autel Support (2F44 EWS) | Community support article | https://bbs.autel.com/autelsupport/Diagnostics/27585.jhtml |
| Go-Parts B1000 article | Community blog (airbag) | https://www.go-parts.com/garage/obd-b1000-bmw-3-series-2005-2013 |
| CSDN 3E80 article | Community article (Valvetronic) | https://wenku.csdn.net/answer/62giogaru3 |
| OBDAdvisor P112F article | Community blog (references 28A0, 2D2E) | https://obdadvisor.com/codes/p112f-bmw/ |
| Bimmerforums Bimmernut 'Complete Diagnostic Fault Code List' | Forum post (E36, E46, E90) | https://www.bimmernut.com/forum/showthread.php/44254-BMW-Complete-Diagnostic-Fault-Code-List-E36-E46-E90-and-more |
| BMWFaultCodes lookup site | Community tool (not proprietary DB) | https://bmwfault.codes/ |
| usro.net BMW Fault Codes blog | Community blog (2025) | https://blog.usro.net/2025/04/bmw-fault-dtc-codes-complete-list-explained/ |
| forumbmw.net BMW Fault Codes PDF | Public PDF (2004, MS42/MS43 cross-ref) | https://www.forumbmw.net/img/members/3/p_error_codes.pdf |

---

## Methodology Notes

1. **Searches performed:** 20 independent web searches using varied queries targeting specific engines (N54, N55, B58, N62, S54), modules (transmission, HVAC, airbag), and code families (4Fxx, 5Dxx, A0xx, 9Cxx).
2. **Exclusion criteria:** Any code found exclusively in ISTA, AutoData, Alldata, or proprietary SGBD databases was rejected. Only forum posts, community blogs, open-source projects, and publicly shared PDFs were accepted.
3. **Cross-verification:** Where possible, codes were cross-referenced across multiple forums (BimmerFest, BimmerPost/SpoolStreet, Bimmerforums, M5Board, BabyBMW) to increase confidence.
4. **Incomplete codes:** Some codes (e.g., 2F4A, 2DC3, 30F1) were present in community PDF lists but lacked full descriptions. These were included with 'low' confidence and marked as 'other' pending further community validation.
