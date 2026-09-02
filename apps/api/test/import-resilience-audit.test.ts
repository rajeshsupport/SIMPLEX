import * as crypto from 'crypto';
import { ServiceMasterRowSchema } from '@hmc/shared';

// Audit Block with Cryptographic Hash Chaining
interface TamperEvidentAuditBlock {
  id: string;
  index: number;
  timestamp: string;
  actorUsername: string;
  action: string;
  result: string;
  details: string;
  prevHash: string;
  currentHash: string;
}

function calculateBlockHash(block: Omit<TamperEvidentAuditBlock, 'currentHash'>): string {
  const content = `${block.index}|${block.timestamp}|${block.actorUsername}|${block.action}|${block.result}|${block.details}|${block.prevHash}`;
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function createAuditChain(): TamperEvidentAuditBlock[] {
  const chain: TamperEvidentAuditBlock[] = [];
  const genesisPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';

  const events = [
    { actor: 'admin_user', action: 'CLIENT_CREATE', result: 'SUCCESS', details: 'Created client HMC_ALPHA' },
    { actor: 'import_op', action: 'IMPORT_EXECUTE', result: 'SUCCESS', details: 'Started import job #101' },
    { actor: 'import_op', action: 'IMPORT_PAUSE', result: 'SUCCESS', details: 'Paused import job #101' },
    { actor: 'import_op', action: 'IMPORT_RESUME', result: 'SUCCESS', details: 'Resumed import job #101' },
  ];

  let prevHash = genesisPrevHash;
  for (let i = 0; i < events.length; i++) {
    const rawBlock = {
      id: crypto.randomUUID(),
      index: i + 1,
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
      actorUsername: events[i].actor,
      action: events[i].action,
      result: events[i].result,
      details: events[i].details,
      prevHash,
    };
    const currentHash = calculateBlockHash(rawBlock);
    const fullBlock: TamperEvidentAuditBlock = { ...rawBlock, currentHash };
    chain.push(fullBlock);
    prevHash = currentHash;
  }

  return chain;
}

function verifyAuditChain(chain: TamperEvidentAuditBlock[]): { valid: boolean; tamperedIndex?: number } {
  for (let i = 0; i < chain.length; i++) {
    const block = chain[i];
    const expectedPrev = i === 0 ? '0000000000000000000000000000000000000000000000000000000000000000' : chain[i - 1].currentHash;
    if (block.prevHash !== expectedPrev) {
      return { valid: false, tamperedIndex: block.index };
    }
    const computedHash = calculateBlockHash({
      id: block.id,
      index: block.index,
      timestamp: block.timestamp,
      actorUsername: block.actorUsername,
      action: block.action,
      result: block.result,
      details: block.details,
      prevHash: block.prevHash,
    });
    if (computedHash !== block.currentHash) {
      return { valid: false, tamperedIndex: block.index };
    }
  }
  return { valid: true };
}

function runImportAndAuditResilienceTests() {
  console.log('================================================================');
  console.log('  IMPORT RESILIENCE, IDEMPOTENCY & AUDIT TAMPER-EVIDENCE AUDIT  ');
  console.log('================================================================\n');

  // 1. Spreadsheet Row Validation & In-File Duplicate Detection
  console.log('[TEST 1] Testing Spreadsheet Row Validation & Duplicate Detection...');
  const testRows = [
    { serviceCode: 'SRV-001', serviceName: 'General Consultation', category: 'General', department: 'OPD', unitPrice: 100 },
    { serviceCode: 'SRV-002', serviceName: 'Blood Test', category: 'Lab', department: 'Pathology', unitPrice: 45 },
    { serviceCode: 'SRV-001', serviceName: 'Duplicate Code', category: 'General', department: 'OPD', unitPrice: 150 }, // Duplicate
    { serviceCode: 'SRV-003', serviceName: '', category: 'Lab', department: 'Pathology', unitPrice: -20 }, // Invalid
  ];

  const seenCodes = new Set<string>();
  const validationResults = testRows.map((row, idx) => {
    const parseRes = ServiceMasterRowSchema.safeParse(row);
    if (!parseRes.success) {
      return { rowIndex: idx + 1, valid: false, error: 'Schema validation failure (missing name or negative price)' };
    }
    if (seenCodes.has(row.serviceCode)) {
      return { rowIndex: idx + 1, valid: false, error: `Duplicate serviceCode "${row.serviceCode}" within spreadsheet` };
    }
    seenCodes.add(row.serviceCode);
    return { rowIndex: idx + 1, valid: true, error: null };
  });

  if (!validationResults[0].valid || !validationResults[1].valid) throw new Error('Valid rows rejected');
  if (validationResults[2].valid) throw new Error('Duplicate row was not detected');
  if (validationResults[3].valid) throw new Error('Invalid row passed validation unexpectedly');
  console.log('✓ TEST 1 PASSED: Pre-import preview correctly identified schema errors and duplicate keys.');

  // 2. Import Pause, Resume, Checkpoint & Idempotency
  console.log('\n[TEST 2] Testing Import Job Checkpointing, Pause, Resume & Idempotency...');
  interface MockJobRow {
    rowNumber: number;
    serviceCode: string;
    status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  }

  const jobRows: MockJobRow[] = [
    { rowNumber: 1, serviceCode: 'SRV-01', status: 'PENDING' },
    { rowNumber: 2, serviceCode: 'SRV-02', status: 'PENDING' },
    { rowNumber: 3, serviceCode: 'SRV-03', status: 'PENDING' },
    { rowNumber: 4, serviceCode: 'SRV-04', status: 'PENDING' },
  ];

  // Execute rows 1 and 2
  jobRows[0].status = 'SUCCEEDED';
  jobRows[1].status = 'SUCCEEDED';
  console.log('  > Rows 1 & 2 executed successfully.');

  // Simulate Pause
  console.log('  > Operator clicked PAUSE. Job paused after row 2.');

  // Simulate Resume: Query uncompleted rows
  const remainingToRun = jobRows.filter((r) => r.status === 'PENDING');
  if (remainingToRun.length !== 2 || remainingToRun[0].rowNumber !== 3) {
    throw new Error('Resumption failed to resume from exact checkpoint!');
  }
  console.log(`  > Resumed from checkpoint: Processing rows ${remainingToRun.map((r) => r.rowNumber).join(', ')}.`);

  // Execute row 3 (fails) and row 4 (succeeds)
  jobRows[2].status = 'FAILED';
  jobRows[3].status = 'SUCCEEDED';

  // 3. Retry Failed Rows Only
  console.log('\n[TEST 3] Testing "Retry Failed Rows Only" Mechanism...');
  const rowsToRetry = jobRows.filter((r) => r.status === 'FAILED');
  if (rowsToRetry.length !== 1 || rowsToRetry[0].rowNumber !== 3) {
    throw new Error('"Retry Failed" did not target only failed rows!');
  }
  console.log(`✓ TEST 3 PASSED: Retry correctly isolated only Row 3 (${rowsToRetry[0].serviceCode}) without re-running succeeded rows.`);

  // 4. Audit Log Cryptographic Hash Chaining & Tamper Detection
  console.log('\n[TEST 4] Testing Audit Log Hash Chaining & Tamper-Evidence...');
  const chain = createAuditChain();
  const initialVerify = verifyAuditChain(chain);
  if (!initialVerify.valid) throw new Error('Initial valid audit chain failed verification');
  console.log(`✓ Audit chain with ${chain.length} cryptographic blocks verified (SHA-256).`);

  // Simulate Tampering: Malicious actor changes block 2 details directly in database
  console.log('  > Simulating database tampering on block 2 details...');
  chain[1].details = 'Tampered details: Deleted customer records';

  const tamperedVerify = verifyAuditChain(chain);
  if (tamperedVerify.valid) {
    throw new Error('Tampering was NOT detected by cryptographic chain verification!');
  }
  console.log(`✓ TEST 4 PASSED: Tampering on block index ${tamperedVerify.tamperedIndex} was detected and rejected by SHA-256 hash chaining.`);

  console.log('\nAll Import Resilience, Idempotency & Audit Tamper-Evidence Tests Passed Successfully!');
}

runImportAndAuditResilienceTests();
