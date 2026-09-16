import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile
} from "node:fs/promises";
import { dirname } from "node:path";

export interface AuditEvent {
  requestId: string;
  workflowId: string;
  agent: string;
  action: string;
  status: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface AuditRecord extends AuditEvent {
  sequence: number;
  previousHash: string;
  hash: string;
}

export interface AuditVerification {
  valid: boolean;
  recordCount: number;
  errors: string[];
}

type UnsignedAuditRecord = Omit<AuditRecord, "hash">;

export class AuditLog {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  append(event: AuditEvent): Promise<AuditRecord> {
    const operation = this.queue.then(() =>
      this.appendInternal(event)
    );

    this.queue = operation.then(
      () => undefined,
      () => undefined
    );

    return operation;
  }

  async readRecords(): Promise<AuditRecord[]> {
    try {
      const contents = await readFile(this.filePath, "utf8");

      return contents
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as AuditRecord);
    } catch (error: unknown) {
      const fileError = error as NodeJS.ErrnoException;

      if (fileError.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  async verify(): Promise<AuditVerification> {
    const records = await this.readRecords();
    const errors: string[] = [];
    let expectedPreviousHash = "GENESIS";

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];

      if (!record) {
        errors.push(`Missing record at position ${index}.`);
        continue;
      }

      const expectedSequence = index + 1;

      if (record.sequence !== expectedSequence) {
        errors.push(
          `Record ${expectedSequence} has invalid sequence ${record.sequence}.`
        );
      }

      if (record.previousHash !== expectedPreviousHash) {
        errors.push(
          `Record ${expectedSequence} has an invalid previous hash.`
        );
      }

      const { hash, ...unsignedRecord } = record;
      const expectedHash = this.calculateHash(unsignedRecord);

      if (hash !== expectedHash) {
        errors.push(
          `Record ${expectedSequence} failed integrity verification.`
        );
      }

      expectedPreviousHash = record.hash;
    }

    return {
      valid: errors.length === 0,
      recordCount: records.length,
      errors
    };
  }

  private async appendInternal(
    event: AuditEvent
  ): Promise<AuditRecord> {
    await mkdir(dirname(this.filePath), {
      recursive: true
    });

    const records = await this.readRecords();
    const previousRecord = records.at(-1);

    const unsignedRecord: UnsignedAuditRecord = {
      ...event,
      sequence: records.length + 1,
      previousHash: previousRecord?.hash ?? "GENESIS"
    };

    const record: AuditRecord = {
      ...unsignedRecord,
      hash: this.calculateHash(unsignedRecord)
    };

    await appendFile(
      this.filePath,
      `${JSON.stringify(record)}\n`,
      "utf8"
    );

    return record;
  }

  private calculateHash(
    record: UnsignedAuditRecord
  ): string {
    return createHash("sha256")
      .update(this.canonicalize(record))
      .digest("hex");
  }

  private canonicalize(value: unknown): string {
    if (
      value === null ||
      typeof value !== "object"
    ) {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value
        .map((item) => this.canonicalize(item))
        .join(",")}]`;
    }

    const object = value as Record<string, unknown>;

    return `{${Object.keys(object)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${this.canonicalize(
            object[key]
          )}`
      )
      .join(",")}}`;
  }
}