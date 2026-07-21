---
name: Reverse payment semantics
description: How reverse/unusual payments (paid-to-customer, received-from-supplier) are detected, calculated, and displayed.
---

## Rule
A **reverse payment** is one that goes against the expected money direction for a party role:
- Customer + `paid` type → firm paid/refunded the customer
- Supplier + `received` type → supplier refunded the firm

## Balance formula (helpers.ts calculateAccounting)
```
reverseEffect = (role === 'customer') ? +totalReversePayment : -totalReversePayment
balance = totalBilled - totalPaid + reverseEffect + openingEffect + miscNet
```
Rationale: refunding a customer increases what they owe us back (or reduces credit). Supplier refunding us decreases what we owe them.

## UI conventions
- **TransactionRow**: `partyRole` prop enables auto-detection; renders amber/orange instead of green/red with a "reverse" badge.
- **PartyDetailView**: `isReversePayment` bool derived from party.role + item.type. Amber border/background, "Reverse" badge, amount shows `+ ` prefix (not `- `), CSV label is "Reverse Pmt (Paid to Customer)" or "Reverse Pmt (Rec. from Supplier)".
- **pdfGenerator.ts**: reverse payments appear in the "Amount (Order)" column with amber color and label "Paid to Party" / "Rec. from Party".

**Why:** Reverse payments are unusual business events that must be visually distinct so users don't misread the ledger. Balance formula sign must be role-aware because the economic effect is opposite for customers vs suppliers.

**How to apply:** Always check `party.role` before determining whether a payment is normal or reverse. Never use payment `type` alone.
