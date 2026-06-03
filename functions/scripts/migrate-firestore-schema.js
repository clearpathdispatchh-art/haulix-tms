/* eslint-disable no-console */
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const { FieldPath } = admin.firestore;

const COMPANY_COLLECTION_PATTERN = /^(loads|customers|drivers|locations)_(.+)$/;

const DEFAULTS = {
  appId: "haulix-tms",
  execute: false,
  companyId: null,
  pageSize: 500,
  userPageSize: 300,
  logEvery: 1000,
  maxRetryAttempts: 5
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };

  argv.forEach((raw) => {
    if (raw === "--execute") {
      args.execute = true;
      return;
    }

    if (raw.startsWith("--appId=")) {
      args.appId = raw.split("=")[1];
      return;
    }

    if (raw.startsWith("--companyId=")) {
      args.companyId = raw.split("=")[1];
      return;
    }

    if (raw.startsWith("--pageSize=")) {
      args.pageSize = parsePositiveInt(raw.split("=")[1], DEFAULTS.pageSize, "pageSize");
      return;
    }

    if (raw.startsWith("--userPageSize=")) {
      args.userPageSize = parsePositiveInt(
        raw.split("=")[1],
        DEFAULTS.userPageSize,
        "userPageSize"
      );
      return;
    }

    if (raw.startsWith("--logEvery=")) {
      args.logEvery = parsePositiveInt(raw.split("=")[1], DEFAULTS.logEvery, "logEvery");
      return;
    }

    if (raw.startsWith("--maxRetryAttempts=")) {
      args.maxRetryAttempts = parsePositiveInt(
        raw.split("=")[1],
        DEFAULTS.maxRetryAttempts,
        "maxRetryAttempts"
      );
    }
  });

  return args;
}

function parsePositiveInt(rawValue, fallback, label) {
  const value = Number.parseInt(rawValue, 10);
  if (Number.isNaN(value) || value <= 0) {
    console.warn(`Invalid --${label} value "${rawValue}". Falling back to ${fallback}.`);
    return fallback;
  }

  return value;
}

function withAuditFields(data, companyId, source) {
  const safeData = data && typeof data === "object" ? data : {};
  const nowIso = new Date().toISOString();
  const createdAt = safeData.createdAt || safeData.dateAdded || nowIso;
  const updatedAt = safeData.updatedAt || createdAt;
  const existingMigration =
    safeData._migration && typeof safeData._migration === "object"
      ? safeData._migration
      : {};

  return {
    ...safeData,
    companyId,
    createdAt,
    updatedAt,
    createdBy: safeData.createdBy || "legacy:migration",
    updatedBy: safeData.updatedBy || "legacy:migration",
    _migration: {
      ...existingMigration,
      source,
      migratedAt: nowIso
    }
  };
}

async function listLegacyCollectionIds(legacyDataDocPath) {
  const collectionRefs = await db.doc(legacyDataDocPath).listCollections();
  return collectionRefs.map((ref) => ref.id);
}

function extractCompanyId(collectionId) {
  const match = COMPANY_COLLECTION_PATTERN.exec(collectionId);
  return match ? match[2] : null;
}

async function paginateCollection(collectionPath, pageSize, onPage) {
  let lastDocId = null;

  while (true) {
    let query = db
      .collection(collectionPath)
      .orderBy(FieldPath.documentId())
      .limit(pageSize);

    if (lastDocId) {
      query = query.startAfter(lastDocId);
    }

    const snap = await query.get();
    if (snap.empty) {
      break;
    }

    await onPage(snap.docs);

    lastDocId = snap.docs[snap.docs.length - 1].id;
    if (snap.size < pageSize) {
      break;
    }
  }
}

async function buildMembershipIndex({ appId, userPageSize, companyIdFilter = null }) {
  const membershipIndex = new Map();
  const discoveredCompanyIds = new Set();
  let indexedProfiles = 0;

  await paginateCollection(`artifacts/${appId}/users`, userPageSize, async (userDocs) => {
    const profileRefs = userDocs.map((userDoc) =>
      db.doc(`artifacts/${appId}/users/${userDoc.id}/profile/info`)
    );

    if (profileRefs.length === 0) {
      return;
    }

    const profileSnaps = await db.getAll(...profileRefs);

    for (let i = 0; i < profileSnaps.length; i += 1) {
      const profileSnap = profileSnaps[i];
      if (!profileSnap.exists) {
        continue;
      }

      const profile = profileSnap.data();
      if (!profile || !profile.companyId) {
        continue;
      }

      const companyId = profile.companyId;
      discoveredCompanyIds.add(companyId);

      if (companyIdFilter && companyId !== companyIdFilter) {
        continue;
      }

      const uid = userDocs[i].id;
      if (!membershipIndex.has(companyId)) {
        membershipIndex.set(companyId, []);
      }

      membershipIndex.get(companyId).push({ uid, profile });
      indexedProfiles += 1;
    }
  });

  return {
    membershipIndex,
    discoveredCompanyIds: Array.from(discoveredCompanyIds).sort(),
    indexedProfiles
  };
}

async function gatherCompanyIds(legacyDataDocPath, discoveredCompanyIds) {
  const companyIds = new Set();

  // 1) Companies registry in legacy structure.
  const legacyCompaniesSnap = await db.collection(`${legacyDataDocPath}/companies`).get();
  legacyCompaniesSnap.docs.forEach((docSnap) => companyIds.add(docSnap.id));

  // 2) Dynamic collections: loads_<companyId>, customers_<companyId>, etc.
  const legacyCollectionIds = await listLegacyCollectionIds(legacyDataDocPath);
  legacyCollectionIds.forEach((collectionId) => {
    const companyId = extractCompanyId(collectionId);
    if (companyId) companyIds.add(companyId);
  });

  // 3) User profile fallback, where companyId is stored today.
  discoveredCompanyIds.forEach((companyId) => companyIds.add(companyId));

  return Array.from(companyIds).sort();
}

function createBulkWriter(maxRetryAttempts) {
  const writer = db.bulkWriter();

  writer.onWriteError((error) => {
    const shouldRetry = error.failedAttempts < maxRetryAttempts;
    console.error(
      `Write error at ${error.documentRef.path}: code=${error.code}, attempts=${error.failedAttempts}, retry=${shouldRetry}`
    );
    return shouldRetry;
  });

  return writer;
}

async function migrateCollection({
  companyId,
  sourceCollectionPath,
  targetCollectionPath,
  dryRun,
  writer,
  pageSize,
  logEvery
}) {
  let migratedCount = 0;

  await paginateCollection(sourceCollectionPath, pageSize, async (docs) => {
    for (const sourceDoc of docs) {
      const payload = withAuditFields(sourceDoc.data(), companyId, sourceCollectionPath);
      const targetRef = db.doc(`${targetCollectionPath}/${sourceDoc.id}`);

      if (!dryRun) {
        writer.set(targetRef, payload, { merge: true });
      }

      migratedCount += 1;
      if (migratedCount % logEvery === 0) {
        console.log(`  ${targetCollectionPath}: processed ${migratedCount}`);
      }
    }
  });

  return migratedCount;
}

async function migrateCompanyProfile({ companyId, legacyDataDocPath, dryRun, writer }) {
  const sourceRef = db.doc(`${legacyDataDocPath}/companies/${companyId}`);
  const sourceSnap = await sourceRef.get();

  const fallback = {
    name: "Haulix",
    status: "active"
  };

  const profileData = sourceSnap.exists ? sourceSnap.data() : fallback;
  const payload = withAuditFields(profileData, companyId, `${legacyDataDocPath}/companies/${companyId}`);
  const targetRef = db.doc(`companies/${companyId}`);

  if (!dryRun) {
    writer.set(targetRef, payload, { merge: true });
  }
}

function toMemberPayload({ appId, companyId, uid, profile }) {
  const nowIso = new Date().toISOString();
  const createdAt = profile.createdAt || nowIso;

  return {
    uid,
    companyId,
    role: profile.role || "dispatcher",
    email: profile.email || "",
    createdAt,
    updatedAt: nowIso,
    createdBy: profile.createdBy || "legacy:migration",
    updatedBy: "legacy:migration",
    _migration: {
      source: `artifacts/${appId}/users/${uid}/profile/info`,
      migratedAt: nowIso
    }
  };
}

async function migrateMemberships({
  appId,
  companyId,
  dryRun,
  writer,
  membershipIndex,
  logEvery
}) {
  const members = membershipIndex.get(companyId) || [];
  let migratedCount = 0;

  for (const member of members) {
    const payload = toMemberPayload({
      appId,
      companyId,
      uid: member.uid,
      profile: member.profile
    });
    const targetRef = db.doc(`companies/${companyId}/members/${member.uid}`);

    if (!dryRun) {
      writer.set(targetRef, payload, { merge: true });
    }

    migratedCount += 1;
    if (migratedCount % logEvery === 0) {
      console.log(`  companies/${companyId}/members: processed ${migratedCount}`);
    }
  }

  return migratedCount;
}

async function migrateCompany({
  appId,
  legacyDataDocPath,
  companyId,
  dryRun,
  writer,
  membershipIndex,
  pageSize,
  logEvery
}) {
  console.log(`\n=== Company ${companyId} ===`);
  await migrateCompanyProfile({ companyId, legacyDataDocPath, dryRun, writer });

  const mapping = [
    { oldPrefix: "loads", newSubcollection: "loads" },
    { oldPrefix: "customers", newSubcollection: "customers" },
    { oldPrefix: "drivers", newSubcollection: "drivers" },
    { oldPrefix: "locations", newSubcollection: "locations" }
  ];

  const totals = {
    loads: 0,
    customers: 0,
    drivers: 0,
    locations: 0,
    members: 0
  };

  for (const item of mapping) {
    const sourceCollectionPath = `${legacyDataDocPath}/${item.oldPrefix}_${companyId}`;
    const targetCollectionPath = `companies/${companyId}/${item.newSubcollection}`;

    const count = await migrateCollection({
      companyId,
      sourceCollectionPath,
      targetCollectionPath,
      dryRun,
      writer,
      pageSize,
      logEvery
    });

    totals[item.newSubcollection] = count;
  }

  totals.members = await migrateMemberships({
    appId,
    companyId,
    dryRun,
    writer,
    membershipIndex,
    logEvery
  });

  console.log(
    `migrated loads=${totals.loads}, customers=${totals.customers}, drivers=${totals.drivers}, locations=${totals.locations}, members=${totals.members}`
  );

  return totals;
}

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !args.execute;
  const legacyDataDocPath = `artifacts/${args.appId}/public/data`;

  console.log("Starting Firestore schema migration");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "EXECUTE"}`);
  console.log(`App ID: ${args.appId}`);
  console.log(`Legacy root: ${legacyDataDocPath}`);
  console.log("Target root: companies/{companyId}/...");
  console.log(`Collection page size: ${args.pageSize}`);
  console.log(`User page size: ${args.userPageSize}`);

  const membershipData = await buildMembershipIndex({
    appId: args.appId,
    userPageSize: args.userPageSize,
    companyIdFilter: args.companyId
  });
  console.log(
    `Indexed ${membershipData.indexedProfiles} memberships from ${membershipData.discoveredCompanyIds.length} companies in user profiles.`
  );

  const companyIds = args.companyId
    ? [args.companyId]
    : await gatherCompanyIds(legacyDataDocPath, membershipData.discoveredCompanyIds);

  if (companyIds.length === 0) {
    console.log("No companies found to migrate.");
    return;
  }

  console.log(`Found companies: ${companyIds.join(", ")}`);

  const grandTotals = {
    loads: 0,
    customers: 0,
    drivers: 0,
    locations: 0,
    members: 0
  };

  let writer = null;
  let writerClosed = false;

  try {
    if (!dryRun) {
      writer = createBulkWriter(args.maxRetryAttempts);
    }

    for (const companyId of companyIds) {
      const totals = await migrateCompany({
        appId: args.appId,
        legacyDataDocPath,
        companyId,
        dryRun,
        writer,
        membershipIndex: membershipData.membershipIndex,
        pageSize: args.pageSize,
        logEvery: args.logEvery
      });

      grandTotals.loads += totals.loads;
      grandTotals.customers += totals.customers;
      grandTotals.drivers += totals.drivers;
      grandTotals.locations += totals.locations;
      grandTotals.members += totals.members;
    }

    if (writer) {
      await writer.close();
      writerClosed = true;
    }
  } finally {
    if (writer && !writerClosed) {
      await writer.close();
    }
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\nTotals migrated: loads=${grandTotals.loads}, customers=${grandTotals.customers}, drivers=${grandTotals.drivers}, locations=${grandTotals.locations}, members=${grandTotals.members}`
  );
  console.log(`Elapsed: ${elapsedSeconds}s`);
  console.log("\nMigration completed.");
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
