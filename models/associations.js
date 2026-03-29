import Sales from "./Sales.js";
import SaleItem from "./SaleItem.js";
import Custumers from "./Custumers.js";
import Appointment from "./Appointment.js";
import Pets from "./Pets.js";
import Services from "./Services.js";
import Users from "./Users.js";
import Subscription from "./Subscription.js";
import PaymentHistory from "./PaymentHistory.js";
import Finance from "./Finance.js";
import AppointmentItem from "./AppointmentItem.js";
import AppointmentPayment from "./AppointmentPayment.js";
import AppointmentStatusHistory from "./AppointmentStatusHistory.js";
import Products from "./Products.js";

// Define as associações
export function setupAssociations() {
  // Sales associations
  Sales.belongsTo(Custumers, { foreignKey: "custumerId" });
  Sales.hasMany(SaleItem, { foreignKey: "saleId" });

  // SaleItem associations
  SaleItem.belongsTo(Sales, { foreignKey: "saleId" });

  // Appointment associations
  Appointment.belongsTo(Pets, { foreignKey: "petId" });
  Appointment.belongsTo(Custumers, { foreignKey: "customerId" });
  Appointment.belongsTo(Services, { foreignKey: "serviceId" });
  Appointment.belongsTo(Users, {
    foreignKey: "responsibleId",
    as: "responsible",
  });
  Appointment.hasMany(AppointmentItem, {
    foreignKey: "appointmentId",
    as: "items",
  });
  Appointment.hasMany(AppointmentPayment, {
    foreignKey: "appointmentId",
    as: "payments",
  });
  Appointment.hasMany(AppointmentStatusHistory, {
    foreignKey: "appointmentId",
    as: "history",
  });
  AppointmentItem.belongsTo(Appointment, {
    foreignKey: "appointmentId",
  });
  AppointmentItem.belongsTo(Services, {
    foreignKey: "serviceId",
    as: "service",
  });
  AppointmentItem.belongsTo(Products, {
    foreignKey: "productId",
    as: "product",
  });
  AppointmentPayment.belongsTo(Appointment, {
    foreignKey: "appointmentId",
  });
  AppointmentPayment.belongsTo(Finance, {
    foreignKey: "financeId",
    as: "finance",
  });
  AppointmentStatusHistory.belongsTo(Appointment, {
    foreignKey: "appointmentId",
  });

  // Subscription associations
  Subscription.belongsTo(Users, { 
    foreignKey: "user_id",
    as: "user" 
  });
  Users.hasMany(Subscription, { 
    foreignKey: "user_id",
    as: "subscriptions" 
  });

  // PaymentHistory associations
  PaymentHistory.belongsTo(Subscription, {
    foreignKey: "subscription_id",
    as: "subscription"
  });
  PaymentHistory.belongsTo(Users, {
    foreignKey: "user_id",
    as: "user"
  });
  
  Subscription.hasMany(PaymentHistory, {
    foreignKey: "subscription_id",
    as: "paymentHistory"
  });
  
  Users.hasMany(PaymentHistory, {
    foreignKey: "user_id",
    as: "paymentHistory"
  });
}
