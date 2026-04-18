import BillingSettings from "../models/BillingSettings.js";

const DEFAULT_BILLING_VALUES = {
  monthlyPrice: 69.9,
  promotionalPrice: 39.9,
  promotionalMonths: 3,
  reminderDays: 7,
};

const ACCESS_GRACE_DAYS = 1;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function calculateDaysUntil(expirationDate, referenceDate = new Date()) {
  const targetDay = startOfLocalDay(expirationDate);
  const referenceDay = startOfLocalDay(referenceDate);
  if (!targetDay || !referenceDay) {
    return null;
  }
  return Math.round((targetDay.getTime() - referenceDay.getTime()) / DAY_IN_MS);
}

export async function getOrCreateBillingSettings() {
  let settings = await BillingSettings.findOne({
    order: [["createdAt", "DESC"]],
  });

  if (!settings) {
    settings = await BillingSettings.create({
      monthlyPrice: DEFAULT_BILLING_VALUES.monthlyPrice,
      promotionalPrice: DEFAULT_BILLING_VALUES.promotionalPrice,
      trialDays: 30,
      promotionalMonths: DEFAULT_BILLING_VALUES.promotionalMonths,
      reminderDays: DEFAULT_BILLING_VALUES.reminderDays,
      mercadoPagoEnabled: true,
    });
  }

  return settings;
}

export function buildBillingProfile(user, subscription, settings) {
  const now = new Date();
  const expirationDate = user?.expirationDate ? new Date(user.expirationDate) : null;
  const daysUntilExpiry = expirationDate ? calculateDaysUntil(expirationDate, now) : null;
  const reminderDays = Number(settings?.reminderDays || DEFAULT_BILLING_VALUES.reminderDays) || DEFAULT_BILLING_VALUES.reminderDays;
  const promotionalMonths = Number(settings?.promotionalMonths || DEFAULT_BILLING_VALUES.promotionalMonths) || DEFAULT_BILLING_VALUES.promotionalMonths;
  const planType = String(subscription?.plan_type || "").toLowerCase();
  const isFree =
    String(subscription?.notes || "").toLowerCase().includes("sem custo") ||
    (subscription?.amount != null &&
      Number(subscription.amount) === 0 &&
      planType !== "trial");

  let stage = "monthly";
  let nextChargeAmount = Number(settings?.monthlyPrice || DEFAULT_BILLING_VALUES.monthlyPrice) || DEFAULT_BILLING_VALUES.monthlyPrice;
  let nextChargePlanType = "monthly";

  if (isFree) {
    stage = "free";
    nextChargeAmount = 0;
  } else if (planType === "trial") {
    stage = "trial";
    nextChargeAmount = Number(settings?.promotionalPrice || DEFAULT_BILLING_VALUES.promotionalPrice) || DEFAULT_BILLING_VALUES.promotionalPrice;
    nextChargePlanType = "promotional";
  } else if (
    planType === "promotional" &&
    Number(subscription?.promotional_months_used || 0) < promotionalMonths
  ) {
    stage = "promotional";
    nextChargeAmount = Number(settings?.promotionalPrice || DEFAULT_BILLING_VALUES.promotionalPrice) || DEFAULT_BILLING_VALUES.promotionalPrice;
    nextChargePlanType = "promotional";
  }

  const reminderDue = !isFree && daysUntilExpiry != null && daysUntilExpiry <= reminderDays && daysUntilExpiry >= 0;
  const overdue = !isFree && daysUntilExpiry != null && daysUntilExpiry < 0;
  const withinGracePeriod = overdue && daysUntilExpiry >= -ACCESS_GRACE_DAYS;
  const accessBlocked = !isFree && daysUntilExpiry != null && daysUntilExpiry < -ACCESS_GRACE_DAYS;

  let noticeKind = "hidden";
  if (accessBlocked) {
    noticeKind = "blocked";
  } else if (withinGracePeriod) {
    noticeKind = "grace";
  } else if (reminderDue) {
    noticeKind = "warning";
  }

  return {
    stage,
    planType,
    expirationDate: expirationDate ? expirationDate.toISOString() : null,
    daysUntilExpiry,
    reminderDays,
    graceDays: ACCESS_GRACE_DAYS,
    reminderDue,
    overdue,
    withinGracePeriod,
    accessBlocked,
    nextChargeAmount,
    nextChargePlanType,
    noticeKind,
  };
}
