# Step 1 - Firestore Schema Refactor (No UI Changes)

This step introduces the **new multi-tenant schema** and a **safe migration tool**.

## New Firestore Structure

```text
companies/{companyId}
companies/{companyId}/members/{uid}
companies/{companyId}/loads/{loadId}
companies/{companyId}/customers/{customerId}
companies/{companyId}/drivers/{driverId}
companies/{companyId}/locations/{locationId}
```

### Notes
- `companyId` is now a first-class tenant boundary.
- We keep `locations` because it is used by current dispatch UI.
- Existing fields are preserved; migration adds audit + migration metadata.

## Legacy -> New Mapping

Legacy root:

```text
artifacts/{appId}/public/data
```

Mappings:
- `loads_{companyId}` -> `companies/{companyId}/loads`
- `customers_{companyId}` -> `companies/{companyId}/customers`
- `drivers_{companyId}` -> `companies/{companyId}/drivers`
- `locations_{companyId}` -> `companies/{companyId}/locations`
- `companies/{companyId}` -> `companies/{companyId}` (profile merge)
- `artifacts/{appId}/users/{uid}/profile/info` -> `companies/{companyId}/members/{uid}`

## Audit Fields Added During Migration

Each migrated document is written with:
- `companyId`
- `createdAt`
- `updatedAt`
- `createdBy` (defaults to `legacy:migration` when missing)
- `updatedBy` (defaults to `legacy:migration` when missing)
- `_migration` metadata with source + timestamp

## Migration Script

File:

```text
functions/scripts/migrate-firestore-schema.js
```

Behavior:
- Default is **dry-run** (no writes).
- Use `--execute` to perform writes.
- Uses idempotent writes: `set(..., { merge: true })`.
- Supports single-company migration via `--companyId=<id>`.

## Commands

From `functions/`:

```bash
npm run migrate:schema:dry
npm run migrate:schema
```

Explicit options:

```bash
node scripts/migrate-firestore-schema.js --appId=haulix-tms
node scripts/migrate-firestore-schema.js --appId=haulix-tms --companyId=abc123 --execute
```

## Safe Rollout Sequence

1. Run dry-run and verify detected companies.
2. Execute migration in a staging project first.
3. Validate document counts for each company and collection.
4. Keep legacy collections untouched until Step 3 frontend cutover is complete.
