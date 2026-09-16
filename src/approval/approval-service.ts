import {
    createHash,
    randomUUID,
    timingSafeEqual
} from "node:crypto";

export interface ActionProposal {
    workflowId: string;
    operationId : string;
    requestBy: string;
    action: string;
    environment: string;
    resources: readonly string[];
    parameters: Record<string, unknown>;
    policyVersion: string;
}

export interface Approver {
    id: string;
    roles: readonly string[];
}

export interface ApprovalRequest {
    approvalId: string;
    proposalHash: string;
  approvedBy: string;
    expiresAt: string;
    usedAt: string;
}

export interface ApprovalRecord {
  approvalId: string;
  proposalHash: string;
  approvedBy: string;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export type ApprovalFailureReason = "not_found" | "expired" | "already_used" | "action_mismatch";

export interface ApprovalVerification {
    valid: boolean;
    reason: "approved" | ApprovalFailureReason;
    approvalId?: string;
}

export class ApprovalService {
    private readonly approvals = new Map<string, ApprovalRecord>();

    constructor(private readonly now: () => Date = () => new Date()) {}

    approve(
      proposal: ActionProposal,
      approver: Approver,
      ttlMs: number = 5 * 60 * 1000
    ): ApprovalRecord {
    if (!approver.roles.includes("approver")) {
        throw new Error("Only a user with the approver role may approve an action." );
    }
        if (approver.id === proposal.requestBy) {
            throw new Error(
                "The requester cannot approve their own action."
            );
        }
if (!approver.roles.includes("approver")) {
  throw new Error(
    "Only a user with the approver role may approve an action."
  );
}
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error(
        "Approval expiration must be greater than zero."
      );
    }

    const issuedAt = this.now();
    const approvalId = randomUUID();

    const record: ApprovalRecord = {
      approvalId,
      proposalHash: this.fingerprint(proposal),
      approvedBy: approver.id,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(
        issuedAt.getTime() + ttlMs
      ).toISOString(),
      usedAt: null
    };

    this.approvals.set(approvalId, record);

    return { ...record };
  }

  verifyAndConsume(
    approvalId: string,
    proposal: ActionProposal
  ): ApprovalVerification {
    const record = this.approvals.get(approvalId);

    if (!record) {
      return {
        valid: false,
        reason: "not_found"
      };
    }

    if (record.usedAt !== null) {
      return {
        valid: false,
        reason: "already_used",
        approvalId
      };
    }

    if (
      this.now().getTime() >=
      new Date(record.expiresAt).getTime()
    ) {
      return {
        valid: false,
        reason: "expired",
        approvalId
      };
    }

    const expectedHash = this.fingerprint(proposal);

    if (
      !this.hashesMatch(
        record.proposalHash,
        expectedHash
      )
    ) {
      return {
        valid: false,
        reason: "action_mismatch",
        approvalId
      };
    }

    record.usedAt = this.now().toISOString();

    return {
      valid: true,
      reason: "approved",
      approvalId
    };
  }

  getApproval(
    approvalId: string
  ): ApprovalRecord | undefined {
    const record = this.approvals.get(approvalId);

    return record ? { ...record } : undefined;
  }

  private fingerprint(
    proposal: ActionProposal
  ): string {
    return createHash("sha256")
      .update(this.canonicalize(proposal))
      .digest("hex");
  }

  private hashesMatch(
    left: string,
    right: string
  ): boolean {
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");

    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
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