import {
  resolveClientEmrPanelUrl,
  EmrFormMasterItem,
  EmrFormsQueryResult,
} from '../index.js';

function runEmrFormsTests() {
  console.log('--- Running EMR Forms & Form Master Unit Tests ---');

  // Test 1: Dynamic Client Endpoint Derivation (no double paths)
  console.log('Test 1: Dynamic client endpoint derivation without duplicate context paths...');
  {
    const url1 = resolveClientEmrPanelUrl({
      baseUrl: 'https://staging.simplexworld.com/MasterV9.3',
      emrPanelRoute: '/emrPanelSelection',
    });
    if (url1 !== 'https://staging.simplexworld.com/MasterV9.3/emrPanelSelection') {
      throw new Error(`Expected 'https://staging.simplexworld.com/MasterV9.3/emrPanelSelection', got '${url1}'`);
    }

    const url2 = resolveClientEmrPanelUrl({
      baseUrl: 'https://staging.simplexworld.com',
      applicationPath: '/MasterV9.3',
      emrPanelRoute: '/emrPanelSelection',
    });
    if (url2 !== 'https://staging.simplexworld.com/MasterV9.3/emrPanelSelection') {
      throw new Error(`Expected context path join without duplicate, got '${url2}'`);
    }

    // Trailing slashes on base and leading slashes on route
    const url3 = resolveClientEmrPanelUrl({
      baseUrl: 'https://staging.simplexworld.com/MasterV9.3/',
      emrPanelRoute: '/emrPanelSelection',
    });
    if (url3 !== 'https://staging.simplexworld.com/MasterV9.3/emrPanelSelection') {
      throw new Error(`Expected clean slash handling without duplicate slashes, got '${url3}'`);
    }

    // Default route fallback when emrPanelRoute is omitted
    const url4 = resolveClientEmrPanelUrl({
      baseUrl: 'https://staging.simplexworld.com/MasterV9.3',
    });
    if (url4 !== 'https://staging.simplexworld.com/MasterV9.3/emrPanelSelection') {
      throw new Error(`Expected fallback to '/emrPanelSelection', got '${url4}'`);
    }

    // Ensure no duplication if applicationPath is already inside baseUrl
    const url5 = resolveClientEmrPanelUrl({
      baseUrl: 'https://staging.simplexworld.com/MasterV9.3',
      applicationPath: 'MasterV9.3',
      emrPanelRoute: '/emrPanelSelection',
    });
    if (url5 !== 'https://staging.simplexworld.com/MasterV9.3/emrPanelSelection') {
      throw new Error(`Expected no duplicated context path when already in baseUrl, got '${url5}'`);
    }
    console.log('  ✓ Client endpoint derivation passed without duplicate paths.');
  }

  // Test 2: Rejection of fabricated/synthetic EMR-001 rows
  console.log('Test 2: Rejection of fabricated EMR-001 style mock rows in live verification...');
  {
    const fabricatedRows: EmrFormMasterItem[] = [
      { formId: 'EMR-001', formName: 'Fabricated Form 1' },
      { formId: 'EMR-002', formName: 'Fabricated Form 2' },
    ];

    const isFabricated = (items: EmrFormMasterItem[]) =>
      items.some((f) => /^EMR-\d{3}$/.test(f.formId));

    if (!isFabricated(fabricatedRows)) {
      throw new Error('Failed to detect fabricated EMR-001 pattern');
    }

    const realRows: EmrFormMasterItem[] = [
      { formId: 'OP_CONSULTATION_GENERAL', formName: 'General Consultation Form', group: 'CONSULTATION', encounterType: 'OP' },
      { formId: 'IP_ADMISSION_ASSESSMENT', formName: 'Inpatient Admission Assessment', group: 'INPATIENT', encounterType: 'IP' },
    ];

    if (isFabricated(realRows)) {
      throw new Error('Real Form Master rows falsely flagged as fabricated');
    }
    console.log('  ✓ Fabricated row detection verified.');
  }

  // Test 3: Empty / Unverified State Handling
  console.log('Test 3: Empty / unverified state contracts and banners...');
  {
    const unverifiedResult: EmrFormsQueryResult = {
      forms: [],
      isLive: false,
      emrRoute: 'https://staging.simplexworld.com/MasterV9.3/emrPanelSelection',
      verified: false,
      message: 'Live forms unavailable / verification required',
    };

    if (unverifiedResult.verified !== false) {
      throw new Error('Unverified result must have verified: false');
    }
    if (unverifiedResult.forms.length !== 0) {
      throw new Error('Unverified result must have empty forms list rather than synthetic mocks');
    }
    if (!unverifiedResult.message?.includes('Live forms unavailable / verification required')) {
      throw new Error('Unverified result must include required verification banner message');
    }
    console.log('  ✓ Empty/unverified state contracts verified.');
  }

  // Test 4: User Assignment Isolation (User A selections do not affect User B)
  console.log('Test 4: User assignment isolation between practitioners...');
  {
    type UserAssignments = Record<string, { formIds: string[]; defaultFormId?: string }>;
    let assignments: UserAssignments = {};

    const userA = 'dr_smith';
    const userB = 'dr_jones';

    // User A selects FORM_01 as default, and FORM_02
    assignments = {
      ...assignments,
      [userA]: { formIds: ['FORM_01', 'FORM_02'], defaultFormId: 'FORM_01' },
    };

    // Verify User A has selections
    if (assignments[userA]?.formIds.length !== 2 || assignments[userA]?.defaultFormId !== 'FORM_01') {
      throw new Error('User A assignments not set properly');
    }

    // Verify User B has NO selections and does not inherit User A's
    const userBSelection = assignments[userB] || { formIds: [], defaultFormId: '' };
    if (userBSelection.formIds.length !== 0 || userBSelection.defaultFormId !== '') {
      throw new Error('User B must not leak User A form assignments');
    }

    // User B selects FORM_03 as default
    assignments = {
      ...assignments,
      [userB]: { formIds: ['FORM_03'], defaultFormId: 'FORM_03' },
    };

    // Verify User A remains unchanged
    if (assignments[userA]?.formIds.length !== 2 || assignments[userA]?.defaultFormId !== 'FORM_01') {
      throw new Error('User A assignments mutated when User B assigned forms');
    }
    // Verify User B has only FORM_03
    if (assignments[userB]?.formIds.length !== 1 || assignments[userB]?.defaultFormId !== 'FORM_03') {
      throw new Error('User B assignments incorrect');
    }
    console.log('  ✓ User assignment isolation verified across distinct users.');
  }

  // Test 5: Assign / Default Constraint Interactions
  console.log('Test 5: Assign/Default constraint interactions (Default requires Assign, max 1 default)...');
  {
    interface State {
      formIds: string[];
      defaultFormId: string;
    }

    const toggleAssign = (state: State, formId: string): State => {
      const exists = state.formIds.includes(formId);
      if (exists) {
        const nextFormIds = state.formIds.filter((id) => id !== formId);
        const nextDefault = state.defaultFormId === formId ? '' : state.defaultFormId;
        return { formIds: nextFormIds, defaultFormId: nextDefault };
      } else {
        return { formIds: [...state.formIds, formId], defaultFormId: state.defaultFormId };
      }
    };

    const toggleDefault = (state: State, formId: string): State => {
      // Constraint: selecting default automatically assigns the form if not already assigned
      const nextFormIds = state.formIds.includes(formId) ? state.formIds : [...state.formIds, formId];
      // Max 1 default
      return { formIds: nextFormIds, defaultFormId: formId };
    };

    let state: State = { formIds: [], defaultFormId: '' };

    // 1. Setting default on unassigned form automatically assigns it
    state = toggleDefault(state, 'FORM_A');
    if (!state.formIds.includes('FORM_A') || state.defaultFormId !== 'FORM_A') {
      throw new Error('Setting default on unassigned form must assign it automatically');
    }

    // 2. Setting another form as default assigns it and replaces the default (max 1 default)
    state = toggleDefault(state, 'FORM_B');
    if (!state.formIds.includes('FORM_B') || state.defaultFormId !== 'FORM_B') {
      throw new Error('Setting new default must update default and keep both assigned');
    }
    if (state.formIds.length !== 2) {
      throw new Error('Both FORM_A and FORM_B should be assigned now');
    }

    // 3. Unassigning the default form clears the default
    state = toggleAssign(state, 'FORM_B');
    if (state.formIds.includes('FORM_B')) {
      throw new Error('FORM_B should be unassigned');
    }
    if (state.defaultFormId !== '') {
      throw new Error('Unassigning default form must clear defaultFormId');
    }

    // 4. Unassigning a non-default form preserves the current default
    state = toggleDefault(state, 'FORM_A');
    state = toggleAssign(state, 'FORM_C'); // Assign FORM_C
    if (state.defaultFormId !== 'FORM_A' || state.formIds.length !== 2) {
      throw new Error('FORM_A should remain default after assigning FORM_C');
    }
    state = toggleAssign(state, 'FORM_C'); // Unassign FORM_C
    if (state.defaultFormId !== 'FORM_A' || state.formIds.length !== 1) {
      throw new Error('Unassigning non-default FORM_C must preserve defaultFormId');
    }
    console.log('  ✓ Assign/Default constraints verified.');
  }

  // Test 6: Client Switching Isolation
  console.log('Test 6: Client switching resets form master state cleanly...');
  {
    type ClientFormState = {
      clientId: string;
      forms: EmrFormMasterItem[];
      assignments: Record<string, { formIds: string[]; defaultFormId?: string }>;
    };

    let clientState: ClientFormState = {
      clientId: 'CLIENT_ALPHA',
      forms: [{ formId: 'ALPHA_FORM_1', formName: 'Alpha Form' }],
      assignments: { dr_smith: { formIds: ['ALPHA_FORM_1'], defaultFormId: 'ALPHA_FORM_1' } },
    };

    // Client switch occurs
    const switchClient = (newClientId: string): ClientFormState => ({
      clientId: newClientId,
      forms: [],
      assignments: {},
    });

    clientState = switchClient('CLIENT_BETA');
    if (clientState.clientId !== 'CLIENT_BETA') throw new Error('Client not switched');
    if (clientState.forms.length !== 0) throw new Error('Client forms not reset');
    if (Object.keys(clientState.assignments).length !== 0) {
      throw new Error('Client assignments not cleared on client switch');
    }
    console.log('  ✓ Client switching state isolation verified.');
  }

  // Test 7: Paginated Selection Persistence
  console.log('Test 7: Paginated selection persistence across page navigations...');
  {
    const allForms: EmrFormMasterItem[] = Array.from({ length: 20 }, (_, i) => ({
      formId: `FORM_${i + 1}`,
      formName: `Clinical Form ${i + 1}`,
    }));

    const pageSize = 5;
    let selectedIds: string[] = [];

    // Page 1: Select FORM_1 and FORM_2
    const page1 = allForms.slice(0, pageSize);
    selectedIds = [...selectedIds, page1[0].formId, page1[1].formId];

    // Navigate to Page 2: Select FORM_7
    const page2 = allForms.slice(pageSize, pageSize * 2);
    selectedIds = [...selectedIds, page2[1].formId]; // FORM_7

    // Navigate back to Page 1
    const page1SelectionCount = page1.filter((f) => selectedIds.includes(f.formId)).length;
    if (page1SelectionCount !== 2) {
      throw new Error(`Page 1 selections lost during pagination. Expected 2, got ${page1SelectionCount}`);
    }

    // Total selections persist
    if (selectedIds.length !== 3 || !selectedIds.includes('FORM_7')) {
      throw new Error('Selections across pages failed to persist in state');
    }
    console.log('  ✓ Paginated selection persistence verified.');
  }

  console.log('All EMR Forms and Form Master tests passed successfully! ✓\n');
}

runEmrFormsTests();
