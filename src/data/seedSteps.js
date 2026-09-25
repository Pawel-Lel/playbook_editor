// Seed data, parsed from the full <LLM_INSTRUCTIONS> XML (DIAGNOSTIC_FLOWS
// section). Every <DIALOG_STEP> became one record; every <Classification>
// became one row in that record's `classifications` array, each of which can
// carry zero or more generalized <Action> elements (Flow_Invocation,
// RAG_Retrieval, Internal_State_Update, ...) plus an optional bare
// <Parameter name="query">, <DialogResponse>, and a `comment` — the source
// document's XML comments (scenario labels, section headers, inline notes)
// rendered as <!-- ... --> immediately above the element they annotate.
// Multiple stacked comments in the source are joined with a blank line and
// re-split into separate <!-- --> blocks on export.

let uid = 0
const nextClassId = () => `c${++uid}`
let actionUid = 0
const nextActionId = () => `a${++actionUid}`

// toolType: 'Flow_Invocation' | 'RAG_Retrieval' | 'Tool_Invocation' |
//           'Internal_State_Update' | '' (custom/other — free text allowed)
function mkAction(toolType, opts = {}) {
  return {
    id: nextActionId(),
    toolType,
    toolId: opts.toolId || '',
    flowId: opts.flowId || '',
    parameterName: opts.parameterName || '',
    parameterValue: opts.parameterValue || ''
  }
}

function cls(classificationId, nextStep, triggerCondition, opts = {}) {
  return {
    id: nextClassId(),
    classificationId,
    nextStep: nextStep || '',
    triggerCondition: triggerCondition || '',
    query: opts.query || '',
    dialogResponse: opts.dialogResponse || '',
    comment: opts.comment || '',
    actions: opts.actions || []
  }
}

function escalationAction(flowId) {
  return [mkAction('Flow_Invocation', { flowId })]
}

export const seedSteps = [
  {
    id: 'NoHotWater_Initial',
    topic: 'No Hot Water Diagnosis',
    issueSummary: 'No hot water from the boiler.',
    instructions: 'Your goal is to identify if the boiler with no hot water is powered by mains gas.',
    comment: 'SCENARIO 1.0 NO HOT WATER',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by mains gas? this means your boiler is connected to the mains supply and you have a gas meter to track your usage.',
    noMatchResponse: "Sorry, I didn't catch a response there, Is your boiler powered by mains gas?",
    noInputResponse: "Sorry, I didn't catch a response there, Is your boiler powered by mains gas?",
    classifications: [
      cls('NO_HOT_WATER_MAINS_GAS', 'Issue_Confirmation_Summary_Final', 'user confirms, yes, mains gas boiler', { query: 'No Hot water on a, Mains Gas Boiler' }),
      cls('NO_HOT_WATER_OTHER_FUEL', 'NoHotWater_FuelSource_Diagnosis', 'user denies, it is not mains gas boiler'),
      cls('DO_NOT_KNOW_FUEL_TYPE_NO_HW', 'Default_Escalation_Hot_Water', 'do not know, not sure', { actions: escalationAction('Default_Escalation_Hot_Water') })
    ]
  },
  {
    id: 'NoHotWater_FuelSource_Diagnosis',
    topic: 'No Hot Water Fuel Identification',
    issueSummary: 'No hot water from boiler (LPG or Oil)',
    instructions: 'Your goal is to identify the boiler/system fuel source (LPG or Oil).',
    comment: '',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by LPG or Oil?',
    noMatchResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG or Oil?",
    noInputResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG or Oil?",
    classifications: [
      cls('NO_HOT_WATER_LPG_BOILER', 'Issue_Confirmation_Summary_Final', 'lpg boiler', { query: 'No Hot water on a LPG boiler' }),
      cls('NO_HOT_WATER_OIL_BOILER', 'Issue_Confirmation_Summary_Final', 'oil boiler', { query: 'No Hot water on a Oil boiler' }),
      cls('DO_NOT_KNOW_FUEL_TYPE', 'Default_Escalation_Hot_Water', 'do not know', { actions: escalationAction('Default_Escalation_Hot_Water') })
    ]
  },
  {
    id: 'Boiler_NotWorkingInitial',
    topic: 'Boiler Fault Diagnosis',
    issueSummary: "Boiler not working correctly, generic issue not necessarly heating related (boiler pump, doesn't stop filing up, etc.)",
    instructions: 'Your goal is to identify if boiler that is not working correctly is powered by mains gas. If boiler is not powered by mains gas go to step ID = "Faulty_Boiler_FuelSource_Diagnosis". If user does not know what gas type powers the boiler, invoke ${FLOW:Default_Escalation_Hot_Water} flow.',
    comment: 'SCENARIO 2.0 BOILER NOT WORKING CORRECTLY',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by mains gas? this means your boiler is connected to the mains supply and you have a gas meter to track your usage.',
    noMatchResponse: "Sorry, I didn't catch a response there, Is your boiler powered by mains gas?",
    noInputResponse: "Sorry, I didn't catch a response there, Is your boiler powered by mains gas?",
    classifications: [
      cls('FUEL_MAINS_GAS_BOILER_CONFIRMATION', 'Issue_Confirmation_Summary_Final', 'user confirms, yes, mains gas boiler', { query: 'Boiler not working correctly, Mains Gas Boiler', comment: 'SCENARIO 2.1 BOILER NOT WORKING CORRECTLY: MAINS GAS' }),
      cls('FUEL_MAINS_GAS_BOILER_DENIED', 'Faulty_Boiler_FuelSource_Diagnosis', 'user denies, it is not mains gas boiler', { comment: 'SCENARIO 2.2 BOILER NOT WORKING CORRECTLY: OTHER TYPE OF FUEL (LPG, OIL, ELECTRIC)' }),
      cls('DO_NOT_KNOW_FUEL_TYPE', 'Default_Escalation_Hot_Water', 'do not know, not sure', { actions: escalationAction('Default_Escalation_Hot_Water'), comment: 'SCENARIO 2.3 BOILER NOT WORKING CORRECTLY: DO NOT KNOW THE FUEL TYPE' })
    ]
  },
  {
    id: 'Faulty_Boiler_FuelSource_Diagnosis',
    topic: 'Heating System Fuel Identification',
    issueSummary: 'Boiler not working correctly (fuel type lpg, oil, electric)',
    instructions: 'Your goal is to idenitfy the boiler/system fuel source (LPG, Oil, Electric/Immersion). If a user made mistake at the initial boiler type classfication and the boiler is powered by Mains Gas (gas boiler), allow user to go back to step ID="Boiler_NotWorkingInitial", and just ask for confirmation if that is a Mains Gas boiler.',
    comment: 'SCENARIO 2.2 BOILER NOT WORKING CORRECTLY: FUEL TYPE LPG, OIL, ELECTRIC',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by LPG, Oil, or it is Electric Boiler?',
    noMatchResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG, Oil or Electric?",
    noInputResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG, Oil or Electric?",
    classifications: [
      cls('LPG_BOILER', 'Issue_Confirmation_Summary_Final', 'lpg boiler', { query: 'Boiler not working correctly, LPG', comment: 'SCENARIO 2.2.1 BOILER NOT WORKING CORRECTLY: FUEL TYPE LPG' }),
      cls('OIL_BOILER', 'Issue_Confirmation_Summary_Final', 'oil boiler', { query: 'Boiler not working correctly, Oil', comment: 'SCENARIO 2.2.2 BOILER NOT WORKING CORRECTLY: OIL' }),
      cls('ELECTRIC_BOILER', 'Issue_Confirmation_Summary_Final', 'electric boiler or immersion heater', { query: 'Boiler not working correctly, Electric', comment: 'SCENARIO 2.2.3 BOILER NOT WORKING CORRECTLY: ELECTRIC' }),
      cls('DO_NOT_KNOW_FUEL_TYPE', 'Default_Escalation_Hot_Water', 'do not know', { actions: escalationAction('Default_Escalation_Hot_Water'), comment: 'SCENARIO 2.2.4 BOILER NOT WORKING CORRECTLY: DO NOT KNOW THE FUEL TYPE' })
    ]
  },
  {
    id: 'Boiler_MakingNoisesInitial',
    topic: 'Boiler Noise Diagnosis',
    issueSummary: 'Unusual boiler noises (kettling, banging, gurgling) fuel source determination (mains gas)',
    instructions: 'Your goal is to identify if the boiler that is making unusual noises (kettling, banging, gurgling) is powered by mains gas. If boiler is not powered by mains gas go to step ID = "Noisy_Boiler_FuelSource_Diagnosis". If user does not know what gas type powers the boiler, invoke ${FLOW:Default_Escalation_Hot_Water} flow.',
    comment: 'SCENARIO 3.0 BOILER MAKING NOISES',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by mains gas? this means your boiler is connected to the mains supply and you have a gas meter to track your usage.',
    noMatchResponse: "Sorry, I didn't catch a response there, Is your boiler powered by mains gas?",
    noInputResponse: "Sorry, I didn't catch a response there, Is your boiler powered by mains gas?",
    classifications: [
      cls('FUEL_MAINS_GAS_BOILER_NOISES_CONFIRMATION', 'Issue_Confirmation_Summary_Final', 'user confirms, yes, mains gas boiler', { query: 'Boiler making noises, Mains Gas Boiler', comment: 'SCENARIO 3.1 BOILER MAKING NOISES: FUEL TYPE mains gas' }),
      cls('FUEL_MAINS_GAS_BOILER_NOISES_DENIED', 'Noisy_Boiler_FuelSource_Diagnosis', 'user denies, it is not mains gas boiler', { comment: 'SCENARIO 3.2 BOILER MAKING NOISES: FUEL TYPE OTHER (FUEL TYPE LPG OIL ELECTRIC)' }),
      cls('DO_NOT_KNOW_FUEL_TYPE', 'Default_Escalation_Hot_Water', 'do not know, not sure', { actions: escalationAction('Default_Escalation_Hot_Water'), comment: 'SCENARIO 3.3 BOILER MAKING NOISES: FUEL TYPE: DO NOT KNOW THE FUEL TYPE' })
    ]
  },
  {
    id: 'Noisy_Boiler_FuelSource_Diagnosis',
    topic: 'Heating System Fuel Identification',
    issueSummary: 'Unusual boiler noises (kettling, banging, gurgling) fuel source determination (LPG, Oil, Electric/Immersion)',
    instructions: 'Your goal is to Identify the boiler/system fuel source (LPG, Oil, Electric/Immersion). If a user made mistake at the initial boiler type classfication and the boiler is powered by Mains Gas (gas boiler), allow user to go back to step ID="Boiler_MakingNoisesInitial", and just ask for confirmation if that is a Mains Gas boiler.',
    comment: 'SCENARIO 3.2 BOILER MAKING NOISES: FUEL TYPE OTHER (LPG, OIL, ELECTRIC)',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by LPG, Oil, or it is Electric Boiler?',
    noMatchResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG, Oil or Electric?",
    noInputResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG, Oil or Electric?",
    classifications: [
      cls('LPG_BOILER', 'Issue_Confirmation_Summary_Final', 'lpg boiler', { query: 'Boiler making noises, LPG boiler', comment: 'SCENARIO 3.2.1 BOILER MAKING NOISES: FUEL TYPE: LPG' }),
      cls('OIL_BOILER', 'Issue_Confirmation_Summary_Final', 'oil boiler', { query: 'Boiler making noises, Oil boiler', comment: 'SCENARIO 3.2.2 BOILER MAKING NOISES: FUEL TYPE: OIL' }),
      cls('ELECTRIC_BOILER', 'Issue_Confirmation_Summary_Final', 'electric boiler or immersion heater', { query: 'Boiler making noises, Electric boiler', comment: 'SCENARIO 3.2.3 BOILER MAKING NOISES: FUEL TYPE: ELECTRIC' }),
      cls('DO_NOT_KNOW_FUEL_TYPE', 'Default_Escalation_Hot_Water', 'do not know, not sure', { actions: escalationAction('Default_Escalation_Hot_Water'), comment: 'SCENARIO 3.2.4 BOILER MAKING NOISES: FUEL TYPE: DO NOT KNOW THE FUEL TYPE' })
    ]
  },
  {
    id: 'Boiler_LowPressureInitial',
    topic: 'Boiler Pressure Diagnosis',
    issueSummary: 'low pressure on a boiler mains gas boiler (gas boiler).',
    instructions: 'Your goal is to identify if low water pressure is on Mains Gas boiler (gas boiler). If the boiler is not powered by mains gas go to step ID = "Low_Pressure_Boiler_FuelSource_Diagnosis". If user does not know what gas type powers the boiler, invoke ${FLOW:Default_Escalation_Hot_Water} flow.',
    comment: 'SCENARIO 4.0 LOW WATER PRESSURE ON BOILER',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by mains gas? this means your boiler is connected to the mains supply and you have a gas meter to track your usage.',
    noMatchResponse: '',
    noInputResponse: '',
    classifications: [
      cls('FUEL_MAINS_GAS_BOILER_LOW_PRESSURE_CONFIRMATION', 'Issue_Confirmation_Summary_Final', 'user confirms that low pressure is on mains gas boiler', { query: 'Low water pressure on a, Mains Gas Boiler', comment: 'SCENARIO 4.1 LOW WATER PRESSURE ON A BOILER: FUEL TYPE mains gas' }),
      cls('FUEL_MAINS_GAS_BOILER_LOW_PRESSURE_DENIED', 'Low_Pressure_Boiler_FuelSource_Diagnosis', 'user denies, it is not mains gas boiler', { comment: 'SCENARIO 4.2 LOW WATER PRESSURE ON A BOILER: FUEL TYPE OTHER (LPG, OIL, ELECTRIC)' }),
      cls('DO_NOT_KNOW_FUEL_TYPE', 'Default_Escalation_Hot_Water', 'do not know, not sure', { actions: escalationAction('Default_Escalation_Hot_Water'), comment: 'SCENARIO 4.3 LOW WATER PRESSURE ON A BOILER: FUEL TYPE: DO NOT KNOW THE FUEL TYPE' })
    ]
  },
  {
    id: 'Low_Pressure_Boiler_FuelSource_Diagnosis',
    topic: 'Heating System Fuel Identification',
    issueSummary: 'Low pressure on a boiler (LPG or OIL)',
    instructions: 'Your goal is to identify if low water pressure is on LPG or Oil. If a user made mistake at the initial boiler type classfication and the boiler is powered by Mains Gas (gas boiler), allow user to go back to step ID="Boiler_LowPressureInitial", and just ask for confirmation if that is a Mains Gas boiler.',
    comment: 'SCENARIO 4.2 LOW WATER PRESSURE ON A BOILER: FUEL TYPE LPG, OIL',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by LPG or OIL?',
    noMatchResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG or OIL?",
    noInputResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG or OIL?",
    classifications: [
      cls('LPG_BOILER', 'Issue_Confirmation_Summary_Final', 'lpg boiler', { query: 'Low water pressure on a, LPG boiler', comment: 'SCENARIO 4.2.1 LOW WATER PRESSURE ON A BOILER: FUEL TYPE LPG' }),
      cls('OIL_BOILER', 'Issue_Confirmation_Summary_Final', 'oil boiler', { query: 'Low water pressure on, an oil boiler', comment: 'SCENARIO 4.2.2 LOW WATER PRESSURE ON A BOILER: FUEL TYPE OIL' })
    ]
  },
  {
    id: 'Heating_NoHeatingHotWaterCheck',
    topic: 'No Heating, Hot Water Status Check',
    issueSummary: 'No heating on a boiler (heating not on, heating is stuck on)',
    instructions: 'Your goal is to check if the lack of heating is accompanied by a lack of hot water.',
    comment: 'SCENARIO 5.0 NO HEATING ON A BOILER',
    promptType: 'InitialQuery',
    prompt: 'Is the boiler still providing hot water?',
    noMatchResponse: '',
    noInputResponse: '',
    classifications: [
      cls('NO_HOT_WATER_CONFIRMED', 'NoHotWater_FuelSource', 'there is no hot water', { comment: 'SCENARIO 5.1 NO HEATING AND NOT HOT WATER ON A BOILER' }),
      cls('HOT_WATER_REMAINS', 'HotWaterRemains_FuelSource', 'there is still hot water', { comment: 'SCENARIO 5.2 NO HEATING AND STILL HOT WATER ON A BOILER' })
    ]
  },
  {
    id: 'NoHotWater_FuelSource',
    topic: 'Boiler Noise Diagnosis',
    issueSummary: 'No hot water and no heating',
    instructions: 'Your goal is to identify if boiler is powered by mains gas, when there is not heating and not not water. If the boiler is not powered by mains gas go to step ID = "No_Heating_No_Hot_Water_Boiler_FuelSource_Diagnosis". If user does not know what gas type powers the boiler, invoke ${FLOW:Default_Escalation_Hot_Water} flow.',
    comment: 'SCENARIO 5.1 NO HOT WATER NO HEATING',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by mains gas? this means your boiler is connected to the mains supply and you have a gas meter to track your usage.',
    noMatchResponse: "Sorry, I didn't catch a response there, Is your boiler powered by mains gas?",
    noInputResponse: "Sorry, I didn't catch a response there, Is your boiler powered by mains gas?",
    classifications: [
      cls('GAS_BOILER_NO_HOT_WATER_NO_HEATING_CONFIRMATION', 'Issue_Confirmation_Summary_Final', 'user confirms, yes, mains gas boiler', { query: 'No heating or Hot water on a Mains Gas Boiler', comment: 'SCENARIO 5.1.1 NO HOT WATER NO HEATING: FUEL SOURCE: MAINS GAS' }),
      cls('FUEL_MAINS_GAS_BOILER_NO_HOT_WATER_NO_HEATIN_DENIED', 'No_Heating_No_Hot_Water_Boiler_FuelSource_Diagnosis', 'user denies, no, it is not mains gas boiler', { comment: 'SCENARIO 5.1.2 NO HOT WATER NO HEATING: FUEL SOURCE: OTHER (LPG, OIL, ELECTRIC)' }),
      cls('DO_NOT_KNOW_FUEL_TYPE', 'Default_Escalation_Hot_Water', 'user do does not know, do not know', { actions: escalationAction('Default_Escalation_Hot_Water'), comment: 'SCENARIO 5.1.3 NO HOT WATER NO HEATING: FUEL TYPE: DO NOT KNOW THE FUEL TYPE' })
    ]
  },
  {
    id: 'HotWaterRemains_FuelSource',
    topic: 'Boiler Noise Diagnosis',
    issueSummary: 'No heating but still hot water (mains gas)',
    instructions: 'Your goal is to identify if boiler is powered by mains gas when there is no heating but there is still hot water. If the boiler is not powered by mains gas go to step ID = "Heating_No_Hot_Water_Boiler_FuelSource_Diagnosis". If user does not know what gas type powers the boiler, invoke ${FLOW:Default_Escalation_Hot_Water} flow.',
    comment: 'SCENARIO 5.2 HOT WATER REMAIN NO HEATING',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by mains gas? this means your boiler is connected to the mains supply and you have a gas meter to track your usage.',
    noMatchResponse: "Sorry, I didn't catch a response there, Is your boiler powered by mains gas?",
    noInputResponse: "Sorry, I didn't catch a response there, Is your boiler powered by mains gas?",
    classifications: [
      cls('GAS_BOILER_HOT_WATER_NO_HEATING_CONFIRMATION', 'Issue_Confirmation_Summary_Final', 'user confirms, yes, mains gas boiler', { query: 'No heating, but there is still hot water on a Mains Gas Boiler', comment: 'SCENARIO 5.2.1 HOT WATER REMAIN NO HEATING: FUEL SOURCE MAINS GAS' }),
      cls('FUEL_MAINS_GAS_BOILER_HOT_WATER_NO_HEATIN_DENIED', 'Heating_No_Hot_Water_Boiler_FuelSource_Diagnosis', 'user denies, it is not mains gas boiler', { comment: 'SCENARIO 5.2.2 HOT WATER REMAIN NO HEATING: FUEL SOURCE OTHER (LPG, OIL, ELECTRIC/IMMERSION)' }),
      cls('DO_NOT_KNOW_FUEL_TYPE', 'Default_Escalation_Hot_Water', 'do not know, not sure', { actions: escalationAction('Default_Escalation_Hot_Water'), comment: 'SCENARIO 5.2.3 HOT WATER REMAIN NO HEATING: FUEL TYPE: DO NOT KNOW THE FUEL TYPE' })
    ]
  },
  {
    id: 'Heating_No_Hot_Water_Boiler_FuelSource_Diagnosis',
    topic: 'Heating System Fuel Identification',
    issueSummary: 'No heating but still hot water (LPG, Oil, Electric/Immersion)',
    instructions: 'Your goal is to identify if boiler is powered by LPG, Oil or Electric/Immersion when there is no heating but there is still hot water. If a user made mistake at the initial boiler type classfication and the boiler is powered by Mains Gas (gas boiler), allow user to go back to step ID="HotWaterRemains_FuelSource", and just ask for confirmation if that is a Mains Gas boiler.',
    comment: 'SCENARIO 5.2.2 HOT WATER REMAIN NO HEATING: FUEL SOURCE OTHER (LPG, OIL, ELECTRIC/IMMERSION)',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by LPG, Oil, or it is Electric Boiler?',
    noMatchResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG, Oil or Electric?",
    noInputResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG, Oil or Electric?",
    classifications: [
      cls('LPG_BOILER', 'Issue_Confirmation_Summary_Final', 'lpg boiler', { query: 'No heating, but there is still hot water on a LPG boiler', comment: 'SCENARIO 5.2.2.1 HOT WATER REMAIN NO HEATING: FUEL SOURCE LPG' }),
      cls('OIL_BOILER', 'Issue_Confirmation_Summary_Final', 'oil boiler', { query: 'No heating, but there is still hot water on a Oil boiler', comment: 'SCENARIO 5.2.2.2 HOT WATER REMAIN NO HEATING: FUEL SOURCE OTHER OIL' }),
      cls('ELECTRIC_BOILER', 'Issue_Confirmation_Summary_Final', 'electric boiler or immersion heater', { query: 'No heating, but there is still hot water on a Electric boiler', comment: 'SCENARIO 5.2.2.3 HOT WATER REMAIN NO HEATING: FUEL SOURCE OTHER (LPG, OIL, ELECTRIC/IMMERSION)' })
    ]
  },
  {
    id: 'No_Heating_No_Hot_Water_Boiler_FuelSource_Diagnosis',
    topic: 'Heating System Fuel Identification',
    issueSummary: 'No heating and no hot water on boiler (LPG, Oil, Electric/Immersion). If a user made mistake at the initial boiler type classfication and the boiler is powered by Mains Gas (gas boiler), allow user to go back to step ID="NoHotWater_FuelSource", and just ask for confirmation if that is a Mains Gas boiler.',
    instructions: 'Your goal is to identify if boiler is powered by LPG, Oil or Electric/Immersion when there is no heating and not hot water.',
    comment: 'SCENARIO 5.1.2 NO HOT WATER AND  NO HEATING: FUEL SOURCE OTHER (LPG, Oil, Electric/Immersion)',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by LPG, Oil, or it is Electric Boiler?',
    noMatchResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG, Oil or Electric?",
    noInputResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG, Oil or Electric?",
    classifications: [
      cls('LPG_BOILER', 'Issue_Confirmation_Summary_Final', 'lpg boiler', { query: 'No heating or Hot water on a LPG boiler', comment: 'SCENARIO 5.1.2.1 HOT WATER REMAIN NO HEATING: FUEL SOURCE LPG' }),
      cls('OIL_BOILER', 'Issue_Confirmation_Summary_Final', 'oil boiler', { query: 'No heating or Hot water on a Oil boiler', comment: 'SCENARIO 5.1.2.2 HOT WATER REMAIN NO HEATING: FUEL SOURCE OIL' }),
      cls('ELECTRIC_BOILER', 'Issue_Confirmation_Summary_Final', 'electric boiler or immersion heater', { query: 'No heating, or Hot Water on Electric boiler', comment: 'SCENARIO 5.1.2.3 HOT WATER REMAIN NO HEATING: FUEL SOURCE ELECTRIC' })
    ]
  },
  {
    id: 'Radiator_Heating_Scope',
    topic: 'Radiator Heating Failure Scope',
    issueSummary: 'Radiator or radiators are not heating up',
    instructions: 'Your goal is to determine if the heating issue affects a single radiator (one) or all (all, most, majority) radiators to diagnose the system fault location',
    comment: 'SCENARIO 6.0 RADIATOR HEATING ISSUE: SCOPE IDENTIFICATION',
    promptType: 'InitialQuery',
    prompt: 'Is it only one radiator or are all radiators not heating up?',
    noMatchResponse: "Sorry, I didn't catch a response there, Is it just one radiator, or are all your radiators not heating?",
    noInputResponse: "Sorry, I didn't catch a response there, Is it just one radiator, or are all your radiators not heating?",
    classifications: [
      cls('RADIATOR_ISSUE_SINGLE', 'SingleRadiator_Troubleshooting', 'only one radiator is not heating up', { comment: 'SCENARIO 6.1 SINGLE RADIATOR ISSUE' }),
      cls('RADIATOR_ISSUE_ALL', 'AllRadiators_Diagnosis', 'all radiators are not heating up, all, most, majority', { comment: 'SCENARIO 6.2  ALL RADIATORS NOT HEATING UP' })
    ]
  },
  {
    id: 'SingleRadiator_Troubleshooting',
    topic: 'Single Radiator Diagnosis',
    issueSummary: 'Single radiator is not heating up',
    instructions: 'Your goal is to confirm with the user that only one radiator is not heating up',
    comment: 'SCENARIO 6.1 SINGLE RADIATOR NOT HEATING',
    promptType: 'InitialQuery',
    prompt: 'OK, Just to confirm a single radiator is not heating up, is that correct?',
    noMatchResponse: "Sorry, I didn't catch a response there, Is your single radiator not heating up",
    noInputResponse: "Sorry, I didn't catch a response there, Is your single radiator not heating up",
    classifications: [
      cls('SINGLE_RADIATOR_FAULT_CONFIRMED', 'Issue_Confirmation_Summary_Final', 'yes, correct, single radiator is not heating', { query: 'Single Radiator is not heating up', comment: 'SCENARIO 6.1.1 SINGLE RADIATOR NOT HEATING: CONFIRMED' }),
      cls('SINGLE_RADIATOR_FAULT_DENIED', 'FINAL_SUMMARY_CONFIRMATION_NO', 'No, incorrect, it is incorrect', { comment: 'SCENARIO 6.1.2 SINGLE RADIATOR NOT HEATING: DENIED' })
    ]
  },
  {
    id: 'AllRadiators_Diagnosis',
    topic: 'All Radiators Not Heating Up Troubleshooting',
    issueSummary: 'All radiators are cold, all radiators are not heating up.',
    instructions: 'Your goal is to identify if boiler is powered by mains gas when all radiators are not heating up. If the boiler is not powered by mains gas go to step ID = "All_Radiators_Not_Heating_Up_FuelSource_Diagnosis". If user does not know what gas type powers the boiler, invoke ${FLOW:Default_Escalation_Hot_Water} flow.',
    comment: 'SCENARIO 6.2 ALL RADIATORS NOT HEATING UP: FUEL TYPE mains gas OR OTHER\n\nThe prompt assumes this step is reached after confirming the fuel type.',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by mains gas? this means your boiler is connected to the mains supply and you have a gas meter to track your usage.',
    noMatchResponse: "Sorry, I didn't catch a response there, Is your boiler powered by mains gas?",
    noInputResponse: "Sorry, I didn't catch a response there, Is your boiler powered by mains gas?",
    classifications: [
      cls('GAS_BOILER_ALL_RADIATORS_NO_HEATING_UP_CONFIRMATION', 'Issue_Confirmation_Summary_Final', 'user confirms, yes, mains gas boiler', { query: 'All Radiators not heating up, Mains Gas Boiler', comment: 'SCENARIO 6.2.1 ALL RADIATORS NOT HEATING UP: FUEL TYPE mains gas' }),
      cls('GAS_BOILER_ALL_RADIATORS_NO_HEATING_UP_DENIED', 'All_Radiators_Not_Heating_Up_FuelSource_Diagnosis', 'user denies, it is not mains gas boiler', { comment: 'SCENARIO 6.2.2 ALL RADIATORS NOT HEATING UP: FUEL TYPE OTHER (LPG, OIL, ELECTRIC)' }),
      cls('DO_NOT_KNOW_FUEL_TYPE', 'Default_Escalation_Hot_Water', 'do not know, not sure', { actions: escalationAction('Default_Escalation_Hot_Water'), comment: 'SCENARIO 6.2.3 ALL RADIATORS NOT HEATING UP: FUEL TYPE: DO NOT KNOW THE FUEL TYPE' })
    ]
  },
  {
    id: 'All_Radiators_Not_Heating_Up_FuelSource_Diagnosis',
    topic: 'Heating System Fuel Identification',
    issueSummary: 'All radiators are not Heating up',
    instructions: 'Your goal is to identify if boiler is powered by LPG, Oil or Electric/Immersion when all radiators are not heating up. If a user made mistake at the initial boiler type classfication and the boiler is powered by Mains Gas (gas boiler), allow user to go back to step ID="AllRadiators_Diagnosis", and just ask for confirmation if that is a Mains Gas boiler.',
    comment: 'SCENARIO 6.2.2 ALL RADIATORS NOT HEATING UP: FUEL TYPE OTHER (LPG, OIL, ELECTRIC)',
    promptType: 'InitialQuery',
    prompt: 'Is your boiler powered by LPG, Oil, or it is Electric Boiler?',
    noMatchResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG, Oil or Electric?",
    noInputResponse: "Sorry, I didn't catch a response there, is your boiler is powered by LPG, Oil or Electric?",
    classifications: [
      cls('LPG_BOILER', 'Issue_Confirmation_Summary_Final', 'lpg boiler', { query: 'All Radiators not heating up, LPG boiler', comment: 'SCENARIO 6.2.2.1 ALL RADIATORS NOT HEATING UP: FUEL TYPE LPG' }),
      cls('OIL_BOILER', 'Issue_Confirmation_Summary_Final', 'oil boiler', { query: 'All Radiators not heating up, Oil boiler', comment: 'SCENARIO 6.2.2.2 ALL RADIATORS NOT HEATING UP: FUEL TYPE OIL' }),
      cls('ELECTRIC_BOILER', 'Issue_Confirmation_Summary_Final', 'electric boiler or immersion heater', { query: 'All Radiators not heating up, Electric boiler', comment: 'SCENARIO 6.2.2.3 ALL RADIATORS NOT HEATING UP: FUEL TYPE ELECTRIC' })
    ]
  },
  {
    id: 'ImmersionHeater_NoHotWater',
    topic: 'Immersion Heater No Hot Water Diagnosis',
    issueSummary: 'No hot water from an immersion heater',
    instructions: 'Your goal is to confirm that user have no hot water on immersion heater',
    comment: 'SCENARIO 7.0 IMMERSION HEATER NO HOT WATER',
    promptType: 'InitialQuery',
    prompt: 'OK, Just to confirm, Is it correct that you have no hot water from your immersion heater?',
    noMatchResponse: "Sorry, I didn't catch a response there, do you have no hot water from your immersion heater?",
    noInputResponse: "Sorry, I didn't catch a response there, do you have no hot water from your immersion heater?",
    classifications: [
      cls('NO_HOT_WATER_FROM_IMMERSION_HEATER_CONFIRMED', 'Issue_Confirmation_Summary_Final', 'user confirms', { query: 'No hot water from an immersion heater', comment: 'SCENARIO 7.1 IMMERSION HEATER NO HOT WATER: CONFIRMED' }),
      cls('NO_HOT_WATER_FROM_IMMERSION_HEATER_DENIED', 'FINAL_SUMMARY_CONFIRMATION_NO', 'user denies', { comment: 'SCENARIO 7.2 IMMERSION HEATER NO HOT WATER: DENIED' })
    ]
  },
  {
    id: 'Thermostat_Fault_Confirmation',
    topic: 'Thermostat Malfunction Confirmation',
    issueSummary: 'Thermostat is not working correctly',
    instructions: 'Your goal is to confirm that thermostat is not working correctly',
    comment: 'SCENARIO 8.0 THERMOSTAT IS NOT WORKING CORRECTLY',
    promptType: 'InitialQuery',
    prompt: 'OK, Just to confirm, your thermostat is not working correctly, is that right?',
    noMatchResponse: "Sorry, I didn't catch a response there, is it correct that your thermostat is not working?",
    noInputResponse: "Sorry, I didn't catch a response there, is it correct that your thermostat is not working?",
    classifications: [
      cls('THERMOSTAT_NOT_WORKING_CORRECTLY_CONFIRMED', 'Issue_Confirmation_Summary_Final', 'user confirms, thermostat is not working correctly', { query: 'Thermostat is not working correctly', comment: 'SCENARIO 8.1 THERMOSTAT IS NOT WORKING CORRECTLY: CONFIRMED' }),
      cls('THERMOSTAT_NOT_WORKING_CORRECTLY_DENIED', 'FINAL_SUMMARY_CONFIRMATION_NO', 'user denies', { comment: 'SCENARIO 8.2 THERMOSTAT IS NOT WORKING CORRECTLY: DENIED' })
    ]
  },
  {
    id: 'Thermostat_PowerStatus',
    topic: 'Smart Thermostat Diagnostics',
    issueSummary: 'Smart thermostat malfunction (Thermostat not working, blank screen, unresponsive device).',
    instructions: 'Your goal is get confirmation from the user that the smart thermostat is faulty',
    comment: 'SCENARIO 9.0 FAULTY SMART THERMOSTAT',
    promptType: 'InitialQuery',
    prompt: 'OK, just to confirm, your smart thermostat is faulty, is that correct?',
    noMatchResponse: "Sorry, I didn't catch a response there, do you have a faulty smart thermostat?",
    noInputResponse: "Sorry, I didn't catch a response there, do you have a faulty smart thermostat?",
    classifications: [
      cls('THERMOSTAT_FAULTY_CONFIRMED', 'Issue_Confirmation_Summary_Final', 'User confrimed that the smart thermostat is faulty', { query: 'I have faulty smart thermostat', comment: 'SCENARIO 9.1 FAULTY SMART THERMOSTAT CONFIRMED\n\nNote: RAG TOOL Query' }),
      cls('THERMOSTAT_FAULTY_DENIED', 'FINAL_SUMMARY_CONFIRMATION_NO', 'User denied that the smart thermostat is faulty', { comment: 'SCENARIO 9.2 FAULTY SMART THERMOSTAT DENIED' })
    ]
  },

  // ---- Section 3: summarizing, confirming and (re-)routing the diagnosis ----

  {
    id: 'Issue_Confirmation_Summary_Final',
    topic: 'Issue Confirmation and Data Processing Handoff',
    issueSummary: 'Final confirmation of the diagnosed issue details before initiating data retrieval and flow escalation.',
    instructions:
      '- Action: Once you have gathered sufficient information, summarize the identified issue to the customer.\n' +
      '- Very Important:\n' +
      '- Confirmation: You must always ask the customer to confirm if your FINAL summary is accurate.\n' +
      '    - Example: "Okay, just to confirm, [DYNAMIC_ISSUE_SUMMARY]. Is that correct?"\n' +
      '    - Then, You must always go to step ID = "Issue_Confirmation_Summary_Final"\n' +
      '- if Customer confirm your findings:\n' +
      '    - Output a concise search query based on questions defiined in Step 1 (one), and nothing else.\n' +
      "    - Always output the best search query you can, even if you suspect it's not needed.\n" +
      '    - You must invoke heating_hot_water_issues_rag_tool\n' +
      '    - you must never show or say parameters returned by heating_hot_water_issues_rag_tool to the Customer\n' +
      '    - you must always return answer from heating_hot_water_issues_rag_tool in JSON format\n' +
      '    - invoke Fulfilment_Escalation flow\n' +
      '- if Customer does not confirm your refined findings:\n' +
      '    - Then, You must always go to step ID = "Issue_Rediagnosis_Router"\n' +
      '    - Allow customer clarify what part of the summary was incorrect and update the details\n' +
      '    - Output a concise search query based on questions defiined in Issue_Rediagnosis_Router step, and nothing else.\n' +
      "    - Always output the best search query you can, even if you suspect it's not needed.\n" +
      '    - You must invoke heating_hot_water_issues_rag_tool\n' +
      '    - you must never show or say parameters returned by heating_hot_water_issues_rag_tool to the Customer\n' +
      '    - you must always return answer from heating_hot_water_issues_rag_tool in JSON format\n' +
      '    - invoke Fulfilment_Escalation flow\n' +
      '- if Customer does not confirm your second refined findings:\n' +
      '    - go to ID = "CONFIRMATION_NO_REFINED" step\n' +
      '    - you must invoke Default_Escalation_Hot_Water flow',
    comment: 'STEP 3.0 SUMMARIZING AND CONFIRMING THE ISSUE (THE MAIN TRIGGER POINT)',
    promptType: 'ConfirmationQuery',
    promptComment: '[DYNAMIC_ISSUE_SUMMARY] will be the full summary generated based on all previous steps',
    prompt: 'Okay, just to confirm [DYNAMIC_ISSUE_SUMMARY]. Is that correct?',
    noMatchResponse: "Sorry, I didn't quite catch that. Is it correct that [DYNAMIC_ISSUE_SUMMARY]?",
    noInputResponse: "Sorry, I didn't quite catch that. Is it correct that [DYNAMIC_ISSUE_SUMMARY]?",
    classifications: [
      cls('FINAL_SUMMARY_CONFIRMATION_YES', 'Data_Retrieval_Phase', 'yes, that is correct', {
        comment: 'STEP 3.0.1 CUSTOMER CONFIRM THE SUMMARY (PROCEED TO DATA HANDOFF)',
        actions: [
          mkAction('RAG_Retrieval', { toolId: 'heating_hot_water_issues_rag_tool', parameterName: 'query', parameterValue: '{CONCISE_SEARCH_QUERY_FROM_DIAGNOSIS}' }),
          mkAction('Flow_Invocation', { flowId: 'Fulfilment_Escalation' })
        ]
      }),
      cls('FINAL_SUMMARY_CONFIRMATION_NO', 'Issue_Rediagnosis_Router', 'no, that is not correct', {
        comment: 'STEP 3.0.2 CUSTOMER DENIES OR CORRECTS THE SUMMARY (REDIRECT TO CLARIFICATION/RE-DIAGNOSIS)',
        dialogResponse: 'Could you tell me which part I have misunderstood so I can update the details?'
      })
    ]
  },
  {
    id: 'Issue_Rediagnosis_Router',
    topic: 'Dynamic Re-Diagnosis and Clarification',
    issueSummary: "The customer has indicated the summary is incorrect. Use the customer's immediate response to trigger specific follow-up questions to refine the diagnosis.",
    instructions: '',
    comment:
      'Rediagnosis Router and Clarification\n' +
      'This step is the pivot point. When the user responds with a correction (e.g., "I have oil boiler"),\n' +
      'the flow engine must identify the required new questions and inject them dynamically.\n' +
      "The 'next_step' leads to a process that asks 1-2 clarifying questions, then loops back to the final confirmation.\n" +
      '\n' +
      'STEP 3.0.2 REDIAGNOSIS ROUTER AND CLARIFICATION',
    promptType: 'InternalProcessing',
    promptComment:
      'Prompt is not required here, as the previous step asked for the clarification. ' +
      "The system now processes the user's statement of correction (e.g., \"I have oil boiler\").",
    prompt: 'Analyzing customer correction and determining required next questions.',
    noMatchResponse: "Sorry, I didn't quite catch that. Is it correct that [DYNAMIC_ISSUE_SUMMARY]?",
    noInputResponse: "Sorry, I didn't quite catch that. Is it correct that [DYNAMIC_ISSUE_SUMMARY]?",
    classifications: [
      cls('CORRECTION_RECEIVED_PROCEED_TO_DYNAMIC_QUESTIONS', '[DYNAMICALLY_GENERATED_QUESTION_FLOW]', 'Correction received and requires follow-up questions.', {
        comment:
          'Dynamic Logic Placeholder:\n' +
          'This classification represents the flow engine detecting the necessary follow-up question(s)\n' +
          "(e.g., based on the user's correction, the system identifies that it needs to ask about\n" +
          "'heating' and 'hot water').\n" +
          '\n' +
          'Action: Trigger the required dynamic question sequence (e.g., the "is mains gas?" sequence\n' +
          'if the issue was hot water or heating related). The output of this sub-flow is the updated summary.'
      }),
      cls('CORRECTION_HANDLED_LOOP_BACK', 'Issue_Confirmation_Summary_Final_Refined', 'Correction handled and new summary is ready.', {
        comment: 'Once the dynamic questions are asked, the flow must loop back to the final confirmation',
        actions: [mkAction('Internal_State_Update', { parameterName: 'Summary_Status', parameterValue: 'REFINED' })]
      })
    ]
  },
  {
    id: 'Issue_Confirmation_Summary_Final_Refined',
    topic: 'Final Refined Confirmation',
    issueSummary: 'Confirm the final, corrected diagnosis before initiating data retrieval',
    instructions: '- Your goal is to identify if the refined summary of the issue is correct.\n- If user does not confirms the refined summary you must escalate by invoking Default_Escalation_Hot_Water flow',
    comment:
      'Refined Summary Confirmation (The loop target)\n' +
      'This step is identical in function to the initial final confirmation, but is used after the rediagnosis questions\n' +
      'have been completed, ensuring the flow meets the requirement of always confirming the FINAL summary.\n' +
      '\n' +
      'STEP 3.0.3 REFINED SUMMARY OF THE ISSUE',
    promptType: 'ConfirmationQuery',
    promptComment: '[REFINED_ISSUE_SUMMARY] will be the updated, confirmed summary',
    prompt: 'Okay, just to confirm [REFINED_ISSUE_SUMMARY]. Is that correct?',
    noMatchResponse: "Sorry, I didn't quite catch that. Is it correct that [REFINED_ISSUE_SUMMARY]?",
    noInputResponse: "Sorry, I didn't quite catch that. Is it correct that [REFINED_ISSUE_SUMMARY]?",
    classifications: [
      cls('CONFIRMATION_YES', 'Data_Retrieval_Phase', 'yes, that is correct', {
        comment: 'STEP 3.0.1: CUSTOMER CONFIRM THE SUMMARY (PROCEED TO DATA HANDOFF)\n\nNote: Query uses the refined details',
        actions: [
          mkAction('RAG_Retrieval', { toolId: 'heating_hot_water_issues_rag_tool', parameterName: 'query', parameterValue: '{CONCISE_SEARCH_QUERY_FROM_REFINED_DIAGNOSIS}' }),
          mkAction('Flow_Invocation', { flowId: 'Fulfilment_Escalation' })
        ]
      }),
      cls('CONFIRMATION_NO_REFINED', '', 'no, that is still not correct', {
        comment: 'STEP 3.0.2 IF THEY STILL SAY NO, INVOKE  Default_Escalation_Hot_Water FLOW',
        actions: [mkAction('Flow_Invocation', { flowId: 'Default_Escalation_Hot_Water' })]
      })
    ]
  }
]

// Nodes referenced as next_step targets that are not themselves DIALOG_STEPs
// in the source XML (terminal / external flow references, or the runtime's
// own dynamic-question placeholder).
export const externalTargets = [
  { id: 'Default_Escalation_Hot_Water', kind: 'flow', label: 'Default Escalation Hot Water (Flow)' },
  { id: 'Fulfilment_Escalation', kind: 'flow', label: 'Fulfilment Escalation (Flow)' },
  { id: 'Data_Retrieval_Phase', kind: 'terminal', label: 'Data Retrieval Phase (downstream system)' },
  { id: 'FINAL_SUMMARY_CONFIRMATION_NO', kind: 'terminal', label: 'Final Summary Confirmation: No (unresolved reference in source XML)' },
  { id: '[DYNAMICALLY_GENERATED_QUESTION_FLOW]', kind: 'dynamic', label: 'Dynamically generated question flow (runtime placeholder)' }
]
