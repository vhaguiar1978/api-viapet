import Appointment from "../models/Appointment.js";
import Custumers from "../models/Custumers.js";
import Pets from "../models/Pets.js";
import Settings from "../models/Settings.js";
import TransportSettings from "../models/TransportSettings.js";
import TransportJob from "../models/TransportJob.js";
import BaileysService from "./baileys.js";
import { sendTextMessage } from "./whatsappOfficial/whatsappSendService.js";
const FALLBACKS={
  pickup_started:"🚐 Olá, {{cliente}}! O motorista do {{petshop}} está a caminho para buscar o(a) {{pet}}.",
  arrived_pickup:"📍 Olá, {{cliente}}! O motorista chegou para buscar o(a) {{pet}}.",
  pet_collected:"🐾 O(a) {{pet}} foi buscado(a) e está a caminho do {{petshop}}.",
  delivery_started:"🚐 Olá, {{cliente}}! O(a) {{pet}} terminou o atendimento e o motorista do {{petshop}} está a caminho para entregar.",
  delivered:"✅ O(a) {{pet}} foi entregue. Obrigado por escolher o {{petshop}}!",
};
const render=(text,values)=>String(text||"").replace(/{{\s*([a-z_]+)\s*}}/gi,(_,key)=>values[key]||"");
export async function sendTransportCustomerMessage({appointmentId,eventType}){const appointment=await Appointment.findByPk(appointmentId);if(!appointment)throw new Error("Agendamento nao encontrado.");const[customer,pet,settings,transportSettings,job]=await Promise.all([Custumers.findOne({where:{id:appointment.customerId,usersId:appointment.usersId}}),Pets.findOne({where:{id:appointment.petId,usersId:appointment.usersId}}),Settings.findOne({where:{usersId:appointment.usersId}}),TransportSettings.findOne({where:{usersId:appointment.usersId}}),TransportJob.findOne({where:{appointmentId,usersId:appointment.usersId}})]);if(!transportSettings?.whatsappEnabled||transportSettings.whatsappEvents?.[eventType]!==true)return{status:"disabled"};const preferenceKey=["pickup_started","arrived_pickup","pet_collected"].includes(eventType)?"pickup":"delivery";if(customer?.taxiDogNotifications?.[preferenceKey]===false)return{status:"customer_opt_out"};if(!customer?.phone)throw new Error("Cliente sem telefone cadastrado.");const body=render(transportSettings.messageTemplates?.[eventType]||FALLBACKS[eventType],{cliente:customer.name,pet:pet?.name,petshop:settings?.storeName||"Pet Shop",motorista:job?.driverName||"motorista",telefone_petshop:settings?.contactPhone||"",horario:String(appointment.time||"").slice(0,5),previsao_chegada:job?.etaMinutes?`${job.etaMinutes} minutos aproximadamente`:""});if(!body.trim())throw new Error("Mensagem automatica nao configurada para este evento.");try{await BaileysService.getInstance(appointment.usersId,"default").sendMessage(customer.phone,body);}catch(baileysError){await sendTextMessage({companyId:appointment.usersId,to:customer.phone,body,conversationId:null}).catch(()=>{throw baileysError;});}return{status:"sent",recipient:customer.phone,message:body};}
