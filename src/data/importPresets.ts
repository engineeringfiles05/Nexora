/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Sample questionnaires (plain text) for trying the importer without a PDF.

import { SAMPLE_RAW_QUESTIONNAIRE_TEXT } from './seedData.ts';

export const IMPORT_PRESETS: { id: string; name: string; description: string; text: string }[] = [
  {
    id: 'sample-ree-power',
    name: '2025 REE Licensure - Power & Machines Examination.pdf',
    description: 'Contains 5 realistic Board exam questions with answers, induction motor formulas, RLC circuits, and PEC code.',
    text: SAMPLE_RAW_QUESTIONNAIRE_TEXT,
  },
  {
    id: 'sample-ee-eval',
    name: 'EE 1 Evaluation Exam.pdf',
    description: 'Contains verified electrical engineering questions on induction motors, RLC resonance, transformers, resistivity, and PEC bends.',
    text: `1. A 3-phase, 4-pole, 60 Hz induction motor has a full-load slip of 4%. Calculate the rotor speed in rpm at full-load.
A. 1728 rpm    B. 1800 rpm    C. 1750 rpm    D. 1680 rpm
[Answer: A]

2. A series RLC circuit has resistance R = 10 Ω, inductance L = 0.1 H, and capacitance C = 100 μF. Determine the resonant frequency in Hertz.
A. 50.33 Hz    B. 159.2 Hz    C. 79.58 Hz    D. 100.0 Hz
[Answer: A]

3. A 25 kVA, 2400/240 V single-phase distribution transformer has a core loss of 200 W and full-load copper loss of 350 W. Calculate the efficiency at full-load with 0.85 power factor lagging.
A. 97.48%      B. 98.20%      C. 96.50%      D. 95.85%
[Answer: A]

4. What is the resistance of a conductor having a resistivity of 1.72 × 10⁻⁸ Ω·m, a length of 100 meters, and a cross-sectional area of 2 mm²?
A. 0.86 Ω      B. 0.43 Ω      C. 1.72 Ω      D. 2.15 Ω
[Answer: A]

5. According to the Philippine Electrical Code (PEC 1), what is the maximum number of quarter bends allowed in a conduit run between pull boxes?
A. 4 quarter bends (360 degrees)
B. 3 quarter bends (270 degrees)
C. 2 quarter bends (180 degrees)
D. 5 quarter bends (450 degrees)
[Answer: A]`,
  },
  {
    id: 'sample-ee-eval-2',
    name: 'EE 2 Evaluation Exam.pdf',
    description: 'Contains verified questions on two-wattmeter method, DC motor back EMF, transformer open/short circuit tests, and AC maximum power.',
    text: `1. Two wattmeters connected to measure the active power of a balanced 3-phase, 3-wire load read 5.0 kW and 2.0 kW respectively. Determine the total active power and the operating power factor of the load.
A. P = 7.0 kW, pf = 0.814 lagging
B. P = 7.0 kW, pf = 0.866 lagging
C. P = 3.0 kW, pf = 0.500 lagging
D. P = 7.0 kW, pf = 0.920 lagging
[Answer: A]

2. A 220 V DC shunt motor has an armature resistance of 0.25 Ω. At rated full load, it draws an armature current of 50 A while running at 1200 rpm. What will be the developed back EMF at full load?
A. 207.5 V    B. 232.5 V    C. 215.0 V    D. 200.0 V
[Answer: A]`,
  },
  {
    id: 'sample-ee-eval-3',
    name: 'EE 3 Evaluation Exam.pdf',
    description: 'Contains verified electrical engineering questions on symmetrical faults, surge impedance, kVAR capacitor bank correction, and illumination.',
    text: `1. A 3-phase, 13.8 kV, 100 MVA synchronous generator has a subtransient reactance Xd" = 0.15 p.u. Calculate the initial symmetrical RMS short-circuit current in amperes for a solid three-phase fault at its terminals.
A. 27,890 A    B. 16,100 A    C. 31,450 A    D. 24,150 A
[Answer: A]

2. A 230 kV three-phase overhead transmission line has a series inductance of 1.25 mH/km and a shunt capacitance of 0.0092 μF/km per phase. Determine the surge impedance (characteristic impedance) of the transmission line in ohms.
A. 368.6 Ω    B. 412.5 Ω    C. 320.0 Ω    D. 285.4 Ω
[Answer: A]

3. An industrial factory draws an active load of 600 kW at an existing power factor of 0.70 lagging from a 480 V, 3-phase, 60 Hz feeder. Calculate the required rating of the shunt capacitor bank in kVAR to improve the overall power factor to 0.95 lagging.
A. 415 kVAR    B. 380 kVAR    C. 450 kVAR    D. 350 kVAR
[Answer: A]

4. An electrical engineering design office measuring 15 m by 10 m requires an average illuminance of 500 lux on the working plane. The luminaires to be installed utilize twin 32 W fluorescent lamps each delivering 2,800 lumens. If the Coefficient of Utilization (CU) is 0.60 and the Maintenance Factor (MF) is 0.75, determine the number of twin-lamp luminaires required.
A. 30 luminaires    B. 25 luminaires    C. 36 luminaires    D. 40 luminaires
[Answer: A]

5. Under the Philippine Electrical Code (PEC 1), what is the maximum standard rating of inverse time circuit breaker permitted for branch circuit short-circuit and ground-fault protection of a single 3-phase squirrel cage induction motor with no code letter, having a full-load current of 40 amperes?
A. 100 A (250% rating)
B. 80 A (200% rating)
C. 125 A (300% rating)
D. 70 A (175% rating)
[Answer: A]`,
  },
  {
    id: 'sample-thermo-mechanics',
    name: 'ESAS_Engineering_Thermodynamics_and_Mechanics.pdf',
    description: 'Contains high-yield questions on Carnot efficiency, static friction, tensile stress, and compound interest.',
    text: `ENGINEERING SCIENCES AND ALLIED SUBJECTS (ESAS)
BOARD EXAMINATION MOCK QUESTIONNAIRE - SET B

1. A heat engine operating on a Carnot cycle absorbs 1500 kJ of heat from a heat reservoir at 600 K and rejects heat to a sink at 300 K. What is the thermal efficiency of the engine?
A. 50%
B. 60%
C. 40%
D. 75%
[Answer Key: A]

2. A 20-kN load is supported by a bronze rod 2 meters long and having a cross-sectional area of 250 mm^2. If E = 100 GPa, calculate the total axial elongation of the rod.
A. 1.60 mm
B. 1.25 mm
C. 2.00 mm
D. 0.80 mm
[Answer Key: A]

3. An electrical engineer borrows ₱100,000 from a bank at an annual interest rate of 12% compounded monthly. How much must be repaid at the end of 2 years?
A. ₱126,973
B. ₱124,000
C. ₱128,500
D. ₱130,200
[Answer Key: A]`,
  },
];
