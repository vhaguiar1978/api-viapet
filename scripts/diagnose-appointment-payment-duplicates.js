import "dotenv/config";
import sequelize from "../database/config.js";

const searchTerm = String(process.argv[2] || "antonio martins").trim();
const summaryOnly = process.argv.includes("--summary");

const normalizeSearch = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const money = (value) => Number(value || 0).toFixed(2);
const valueOf = (row) => Number(row.grossAmount ?? row.amount ?? 0) || 0;
const statusOf = (row) => String(row.status || "").toLowerCase();
const refOf = (row) => String(row.reference || "").trim();

function groupBy(list, keyFor) {
  return list.reduce((groups, item) => {
    const key = keyFor(item);
    const bucket = groups.get(key) || [];
    bucket.push(item);
    groups.set(key, bucket);
    return groups;
  }, new Map());
}

function classifyAppointmentRows(rows) {
  const active = rows.filter((row) => statusOf(row) !== "cancelado");
  const paymentRows = active.filter((row) => refOf(row).startsWith("appointment_payment:"));
  const balanceRows = active.filter((row) => refOf(row).startsWith("appointment_balance:"));
  const legacyRows = active.filter((row) => refOf(row) === "appointment");
  const exactDuplicates = [...groupBy(active, (row) => [
    statusOf(row),
    String(row.dueDate || "").slice(0, 10),
    String(row.paymentMethod || "").toLowerCase(),
    money(valueOf(row)),
  ].join("|")).values()].filter((bucket) => bucket.length > 1);

  const paymentTotal = paymentRows.reduce((sum, row) => sum + valueOf(row), 0);
  const balanceTotal = balanceRows.reduce((sum, row) => sum + valueOf(row), 0);
  const repeatedPaymentAndBalance =
    paymentRows.length > 0 &&
    balanceRows.length > 0 &&
    paymentRows.some((payment) =>
      balanceRows.some((balance) => money(valueOf(payment)) === money(valueOf(balance))),
    );

  return {
    active,
    paymentRows,
    balanceRows,
    legacyRows,
    exactDuplicates,
    paymentTotal,
    balanceTotal,
    suspected:
      exactDuplicates.length > 0 ||
      repeatedPaymentAndBalance ||
      (legacyRows.length > 0 && paymentRows.length > 0),
    reason: exactDuplicates.length
      ? "lancamentos com mesmo valor/data/meio/status"
      : repeatedPaymentAndBalance
        ? "pagamento e saldo repetem o mesmo valor"
        : legacyRows.length > 0 && paymentRows.length > 0
          ? "registro legado e registro novo coexistem"
          : "",
  };
}

async function loadCustomers() {
  const [rows] = await sequelize.query(
    `SELECT c.id, c."usersId", c.name, c.phone
       FROM custumers c
      WHERE LOWER(c.name) LIKE :term
      ORDER BY c.name`,
    { replacements: { term: `%${searchTerm.toLowerCase()}%` } },
  );
  return rows;
}

async function loadAppointmentsForCustomers(customerIds) {
  if (!customerIds.length) return [];
  const [rows] = await sequelize.query(
    `SELECT a.id, a."usersId", a."customerId", a.date, a.time, a.status,
            a.package, a."packageNumber", a."packageMax", a."packageGroupId",
            a."financeId", c.name AS "customerName", p.name AS "petName"
       FROM appointments a
       JOIN custumers c ON c.id = a."customerId"
       LEFT JOIN pets p ON p.id = a."petId"
      WHERE a."customerId" IN (:customerIds)
      ORDER BY a.date DESC, a.time DESC`,
    { replacements: { customerIds } },
  );
  return rows;
}

async function loadFinanceForTenant(usersId) {
  const [rows] = await sequelize.query(
    `SELECT id, "usersId", description, amount, "grossAmount", "netAmount",
            date, "dueDate", "paymentMethod", status, reference, "createdAt", "updatedAt"
       FROM finances
      WHERE "usersId" = :usersId
        AND (
          reference = 'appointment'
          OR reference LIKE 'appointment_payment:%'
          OR reference LIKE 'appointment_balance:%'
          OR reference LIKE 'appointment_free:%'
        )
      ORDER BY "createdAt" DESC`,
    { replacements: { usersId } },
  );
  return rows;
}

async function loadTenantAppointments(usersId) {
  const [rows] = await sequelize.query(
    `SELECT a.id, a."customerId", a.date, a.time, a.status, a.package,
            a."packageNumber", a."packageMax", a."packageGroupId", a."financeId",
            c.name AS "customerName", p.name AS "petName"
       FROM appointments a
       JOIN custumers c ON c.id = a."customerId"
       LEFT JOIN pets p ON p.id = a."petId"
      WHERE a."usersId" = :usersId`,
    { replacements: { usersId } },
  );
  return rows;
}

async function loadPaymentsForTenant(usersId) {
  const [rows] = await sequelize.query(
    `SELECT id, "appointmentId", "financeId", "dueDate", "paymentMethod", amount,
            "grossAmount", "netAmount", status, "paidAt", "createdAt"
       FROM appointment_payments
      WHERE "usersId" = :usersId
      ORDER BY "createdAt" DESC`,
    { replacements: { usersId } },
  );
  return rows;
}

async function loadObjectiveAnomalies(usersId) {
  const [duplicateOccurrences] = await sequelize.query(
    `SELECT c.name AS "customerName", p.name AS "petName", a."packageGroupId",
            a."packageNumber", COUNT(*)::int AS count, ARRAY_AGG(a.id) AS "appointmentIds"
       FROM appointments a
       JOIN custumers c ON c.id = a."customerId"
       LEFT JOIN pets p ON p.id = a."petId"
      WHERE a."usersId" = :usersId
        AND COALESCE(a."packageGroupId", '') <> ''
      GROUP BY c.name, p.name, a."packageGroupId", a."packageNumber"
     HAVING COUNT(*) > 1
      ORDER BY c.name, p.name, a."packageGroupId", a."packageNumber"`,
    { replacements: { usersId } },
  );
  const [duplicateBalances] = await sequelize.query(
    `SELECT c.name AS "customerName", p.name AS "petName", a.date, f.reference,
            COUNT(*)::int AS count, ARRAY_AGG(f.id) AS "financeIds",
            SUM(COALESCE(f."grossAmount", f.amount)) AS total
       FROM finances f
       JOIN appointments a ON f.reference = CONCAT('appointment_balance:', a.id)
       JOIN custumers c ON c.id = a."customerId"
       LEFT JOIN pets p ON p.id = a."petId"
      WHERE f."usersId" = :usersId
        AND f.status <> 'cancelado'
      GROUP BY c.name, p.name, a.date, f.reference
     HAVING COUNT(*) > 1
      ORDER BY c.name, p.name, a.date`,
    { replacements: { usersId } },
  );
  const [duplicatePaymentFingerprints] = await sequelize.query(
    `SELECT c.name AS "customerName", p.name AS "petName", a.date, ap."appointmentId",
            ap.status, ap."paymentMethod", COALESCE(ap."grossAmount", ap.amount) AS amount,
            COUNT(*)::int AS count, ARRAY_AGG(ap.id) AS "paymentIds"
       FROM appointment_payments ap
       JOIN appointments a ON a.id = ap."appointmentId"
       JOIN custumers c ON c.id = a."customerId"
       LEFT JOIN pets p ON p.id = a."petId"
      WHERE ap."usersId" = :usersId
        AND ap.status <> 'cancelado'
      GROUP BY c.name, p.name, a.date, ap."appointmentId", ap.status, ap."paymentMethod",
               COALESCE(ap."grossAmount", ap.amount)
     HAVING COUNT(*) > 1
      ORDER BY c.name, p.name, a.date`,
    { replacements: { usersId } },
  );

  return { duplicateOccurrences, duplicateBalances, duplicatePaymentFingerprints };
}

function associatedRows(appointment, financeRows, paymentsByAppointmentId) {
  const paymentFinanceIds = new Set(
    (paymentsByAppointmentId.get(appointment.id) || [])
      .map((payment) => Number(payment.financeId))
      .filter(Boolean),
  );

  return financeRows.filter((finance) =>
    Number(finance.id) === Number(appointment.financeId) ||
    paymentFinanceIds.has(Number(finance.id)) ||
    refOf(finance) === `appointment_balance:${appointment.id}` ||
    refOf(finance) === `appointment_free:${appointment.id}`,
  );
}

function printAppointment(appointment, rows, paymentRows) {
  const assessment = classifyAppointmentRows(rows);
  console.log(
    `\n${appointment.date} ${String(appointment.time || "").slice(0, 5)} | ${appointment.customerName} | pet=${appointment.petName || "-"} | agendamento=${appointment.id}`,
  );
  console.log(
    `  pacote=${Boolean(appointment.package)} grupo=${appointment.packageGroupId || "-"} sessao=${appointment.packageNumber || "-"}/${appointment.packageMax || "-"}`,
  );
  paymentRows.forEach((payment) => {
    console.log(
      `  paymentRow ${payment.id} status=${payment.status} valor=${money(payment.grossAmount || payment.amount)} financeId=${payment.financeId || "-"}`,
    );
  });
  rows.forEach((finance) => {
    console.log(
      `  finance ${finance.id} status=${finance.status} valor=${money(valueOf(finance))} meio=${finance.paymentMethod || "-"} ref=${finance.reference || "-"} criado=${new Date(finance.createdAt).toISOString()}`,
    );
  });
  if (assessment.suspected) {
    console.log(`  [SUSPEITA] ${assessment.reason}`);
  }
  return assessment;
}

async function run() {
  await sequelize.authenticate();
  console.log(`=== Diagnostico de duplicidade de pagamentos: "${searchTerm}" ===`);
  const customers = await loadCustomers();

  if (!customers.length) {
    console.log("Nenhum cliente encontrado para o termo informado.");
    return;
  }

  for (const customer of customers) {
    console.log(`\nCliente encontrado: ${customer.name} | id=${customer.id} | tenant=${customer.usersId}`);
  }

  const tenants = [...new Set(customers.map((customer) => customer.usersId).filter(Boolean))];
  const targetAppointments = await loadAppointmentsForCustomers(customers.map((customer) => customer.id));

  for (const usersId of tenants) {
    const [financeRows, tenantAppointments, paymentRows, anomalies] = await Promise.all([
      loadFinanceForTenant(usersId),
      loadTenantAppointments(usersId),
      loadPaymentsForTenant(usersId),
      loadObjectiveAnomalies(usersId),
    ]);
    const paymentsByAppointmentId = groupBy(paymentRows, (payment) => payment.appointmentId);

    console.log(`\n=== Auditoria objetiva do tenant ${usersId} ===`);
    const affectedCustomers = [
      ...new Set(
        [
          ...anomalies.duplicateOccurrences,
          ...anomalies.duplicateBalances,
          ...anomalies.duplicatePaymentFingerprints,
        ].map((row) => row.customerName),
      ),
    ].sort((left, right) => left.localeCompare(right, "pt-BR"));
    console.log(`Clientes com ao menos uma anomalia: ${affectedCustomers.length}`);
    console.log(`  ${affectedCustomers.join("; ") || "nenhum"}`);
    console.log(`Sessoes duplicadas no mesmo pacotinho/numero: ${anomalies.duplicateOccurrences.length}`);
    anomalies.duplicateOccurrences.forEach((row) => {
      console.log(`  ${row.customerName} | ${row.petName || "-"} | sessao ${row.packageNumber} | repeticoes=${row.count}`);
    });
    console.log(`Saldos duplicados para a mesma referencia: ${anomalies.duplicateBalances.length}`);
    anomalies.duplicateBalances.forEach((row) => {
      console.log(`  ${row.customerName} | ${row.petName || "-"} | ${String(row.date).slice(0, 10)} | repeticoes=${row.count} | total=${money(row.total)}`);
    });
    console.log(`Pagamentos repetidos no mesmo atendimento/valor/meio/status: ${anomalies.duplicatePaymentFingerprints.length}`);
    anomalies.duplicatePaymentFingerprints.forEach((row) => {
      console.log(`  ${row.customerName} | ${row.petName || "-"} | ${String(row.date).slice(0, 10)} | ${row.status} ${row.paymentMethod} ${money(row.amount)} | repeticoes=${row.count}`);
    });

    if (!summaryOnly) {
      console.log(`\n=== Cliente pesquisado no tenant ${usersId} ===`);
      const tenantTargetAppointments = targetAppointments.filter(
        (appointment) => appointment.usersId === usersId,
      );
      if (!tenantTargetAppointments.length) {
        console.log("Cliente sem agendamentos.");
      }
      tenantTargetAppointments.forEach((appointment) => {
        printAppointment(
          appointment,
          associatedRows(appointment, financeRows, paymentsByAppointmentId),
          paymentsByAppointmentId.get(appointment.id) || [],
        );
      });

      const suspects = tenantAppointments
        .map((appointment) => {
          const rows = associatedRows(appointment, financeRows, paymentsByAppointmentId);
          const assessment = classifyAppointmentRows(rows);
          return { appointment, rows, assessment };
        })
        .filter(({ assessment }) => assessment.suspected);

      console.log(`\n=== Varredura do tenant: ${suspects.length} agendamento(s) suspeito(s) ===`);
      suspects.forEach(({ appointment, rows }) => {
        printAppointment(appointment, rows, paymentsByAppointmentId.get(appointment.id) || []);
      });
    }
  }
}

try {
  await run();
} catch (error) {
  console.error("Erro no diagnostico:", error.message);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
