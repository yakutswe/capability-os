import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AuditLog } from "../audit-log.js";

function createEvent(action: string) {
  return {
    requestId: "request-001",
    workflowId: "workflow-001",
    agent: "test-agent",
    action,
    status: "completed",
    timestamp: "2026-09-16T00:00:00.000Z",
    details: {
      environment: "test"
    }
  };
}

test("creates a valid hash-chained audit trail", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "capability-os-audit-")
  );

  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true
    });
  });

  const auditLog = new AuditLog(
    join(directory, "audit.jsonl")
  );

  const first = await auditLog.append(
    createEvent("discovery")
  );

  const second = await auditLog.append(
    createEvent("integration")
  );

  assert.equal(first.sequence, 1);
  assert.equal(first.previousHash, "GENESIS");
  assert.equal(second.sequence, 2);
  assert.equal(second.previousHash, first.hash);

  const verification = await auditLog.verify();

  assert.equal(verification.valid, true);
  assert.equal(verification.recordCount, 2);
  assert.deepEqual(verification.errors, []);
});

test("detects a tampered audit record", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "capability-os-audit-")
  );

  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true
    });
  });

  const filePath = join(directory, "audit.jsonl");
  const auditLog = new AuditLog(filePath);

  await auditLog.append(createEvent("policy"));

  const originalContents = await readFile(
    filePath,
    "utf8"
  );

  const tamperedContents = originalContents.replace(
    '"status":"completed"',
    '"status":"tampered"'
  );

  await writeFile(
    filePath,
    tamperedContents,
    "utf8"
  );

  const verification = await auditLog.verify();

  assert.equal(verification.valid, false);
  assert.ok(
    verification.errors.some((error) =>
      error.includes("integrity verification")
    )
  );
});

test("serializes concurrent audit writes", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "capability-os-audit-")
  );

  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true
    });
  });

  const auditLog = new AuditLog(
    join(directory, "audit.jsonl")
  );

  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      auditLog.append(
        createEvent(`concurrent-action-${index + 1}`)
      )
    )
  );

  const records = await auditLog.readRecords();
  const verification = await auditLog.verify();

  assert.deepEqual(
    records.map((record) => record.sequence),
    [1, 2, 3, 4, 5]
  );

  assert.equal(verification.valid, true);
  assert.equal(verification.recordCount, 5);
});