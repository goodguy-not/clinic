# Decision Log

Keep entries concise. Store final decisions, not chat transcripts.

## Template

**Date:** YYYY-MM-DD  
**Status:** Proposed | Accepted | Rejected | Superseded  
**Topic:**

- **Decision:**
- **Alternatives:**
- **Reason:**
- **Trade-off:**
- **Assumptions:**
- **Revisit when:**

## Accepted baseline

### Manual facts, automatic calculations

Receptionist records facts; the system derives sessions, charges, payments, credit/balance, and overdue promises.

### Family-level account

Balance belongs to the family; charge detail identifies the child.

### No online payment or native app initially

Initial value is reliable internal tracking. Parent-facing/native features are reconsidered after workflow and usage evidence.

### Next.js + NestJS direction

Next.js owns public/internal presentation and a selective BFF. NestJS owns PostgreSQL, domain rules, authorization, transactions, and audit. Implementation details remain open to reasoned refinement.
