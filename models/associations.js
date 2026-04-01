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
import CrmConversation from "./CrmConversation.js";
import CrmConversationMessage from "./CrmConversationMessage.js";
import CrmAiActionLog from "./CrmAiActionLog.js";

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

  // CRM Conversations
  CrmConversation.belongsTo(Custumers, {
    foreignKey: "customerId",
    as: "customer",
  });
  CrmConversation.belongsTo(Pets, {
    foreignKey: "petId",
    as: "pet",
  });
  CrmConversation.belongsTo(Users, {
    foreignKey: "assignedUserId",
    as: "assignedUser",
  });
  CrmConversation.hasMany(CrmConversationMessage, {
    foreignKey: "conversationId",
    as: "messages",
  });
  CrmConversation.hasMany(CrmAiActionLog, {
    foreignKey: "conversationId",
    as: "aiLogs",
  });

  CrmConversationMessage.belongsTo(CrmConversation, {
    foreignKey: "conversationId",
    as: "conversation",
  });
  CrmConversationMessage.belongsTo(Custumers, {
    foreignKey: "customerId",
    as: "customer",
  });
  CrmConversationMessage.belongsTo(Pets, {
    foreignKey: "petId",
    as: "pet",
  });
  CrmConversationMessage.belongsTo(Users, {
    foreignKey: "authorUserId",
    as: "authorUser",
  });

  CrmAiActionLog.belongsTo(CrmConversation, {
    foreignKey: "conversationId",
    as: "conversation",
  });
  CrmAiActionLog.belongsTo(Custumers, {
    foreignKey: "customerId",
    as: "customer",
  });
  CrmAiActionLog.belongsTo(Pets, {
    foreignKey: "petId",
    as: "pet",
  });
  CrmAiActionLog.belongsTo(Appointment, {
    foreignKey: "appointmentId",
    as: "appointment",
  });
  CrmAiActionLog.belongsTo(Users, {
    foreignKey: "authorUserId",
    as: "authorUser",
  });
}
