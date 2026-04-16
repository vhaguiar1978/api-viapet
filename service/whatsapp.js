import axios from "axios";
import express from "express";
import Appointment from "../models/Appointment.js";
import Settings from "../models/Settings.js";
import Pets from "../models/Pets.js";
import Custumers from "../models/Custumers.js";
import Services from "../models/Services.js";
import Drivers from "../models/Drivers.js";
import Users from "../models/Users.js";
import CrmWhatsappMessage from "../models/CrmWhatsappMessage.js";
import CrmConversation from "../models/CrmConversation.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";
const router = express.Router();
import { Op } from "sequelize";

// ─── Helpers para URL/token dinâmicos por usuário ────────────────────────────
function resolveWhatsappApiUrl(settings) {
  const config = settings?.whatsappConnection || {};
  const phoneNumberId =
    config.phoneNumberId ||
    process.env.WHATSAPP_PHONE_NUMBER_ID ||
    "465822306605861"; // fallback legado
  return `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
}

function resolveWhatsappApiToken(settings) {
  const config = settings?.whatsappConnection || {};
  return config.accessToken || process.env.WHATSAPP_TOKEN || "";
}

export async function mensagemMotorista(idAgendamento, status = null) {
  try {
    if (!idAgendamento) {
      throw new Error("ID do agendamento é obrigatório");
    }

    // Buscar o agendamento com todas as relações necessárias
    const agendamento = await Appointment.findOne({
      where: { id: idAgendamento },
      include: [
        {
          model: Pets,
          attributes: ["name"],
        },
        {
          model: Custumers,
          attributes: ["name", "phone", "address"],
        },
        {
          model: Services,
          attributes: ["name"],
        },
      ],
    });

    if (!agendamento) {
      throw new Error("Agendamento não encontrado");
    }

    // Se não houver status, apenas retorna sucesso
    if (!status) {
      return { success: true, message: "Motorista atualizado com sucesso" };
    }

    if (!agendamento.Custumer?.phone) {
      throw new Error("Cliente não possui telefone cadastrado");
    }

    // Buscar motorista diretamente
    const motorista = await Drivers.findOne({
      where: { id: agendamento.driverId },
    });

    if (!motorista?.phone) {
      throw new Error(
        "Motorista não possui telefone cadastrado ou não está atribuído ao agendamento",
      );
    }

    // Formatar telefone do motorista
    let phoneMotorista = motorista.phone.replace(/\D/g, "");
    if (!phoneMotorista.startsWith("55")) {
      phoneMotorista = "55" + phoneMotorista;
    }

    // Formatar telefone do cliente
    let phoneCliente = agendamento.Custumer.phone.replace(/\D/g, "");
    if (!phoneCliente.startsWith("55")) {
      phoneCliente = "55" + phoneCliente;
    }

    // Validar status
    if (!["Entregar pet", "Buscar pet"].includes(status)) {
      throw new Error('Status inválido. Use "Entregar pet" ou "Buscar pet"');
    }

    // Enviar mensagem para o motorista
    const templateNameMotorista =
      status === "Entregar pet"
        ? "viapet_motoristamensagementregar"
        : "viapet_motoristamensagem";

    // Parâmetros base para ambos os casos
    const parametersMotorista = [
      {
        type: "text",
        parameter_name: "nome",
        text: motorista.name || "-",
      },
      {
        type: "text",
        parameter_name: "nome_pet",
        text: agendamento.Pet?.name || "-",
      },
      {
        type: "text",
        parameter_name: "nome_tutor",
        text: agendamento.Custumer.name || "-",
      },
      {
        type: "text",
        parameter_name: "horario",
        text: agendamento.time || "-",
      },
    ];

    // Adiciona endereço apenas se for para buscar
    if (status === "Buscar pet") {
      parametersMotorista.push({
        type: "text",
        parameter_name: "endereco_busca",
        text: agendamento.Custumer.address || "-",
      });
    } else if (status === "Entregar pet") {
      parametersMotorista.push({
        type: "text",
        parameter_name: "endereco",
        text: agendamento.Custumer.address || "-",
      });
    }

    // Buscar configuracao por usuário para URL/token dinâmicos
    const settingsMotorista = await Settings.findOne({ where: { usersId: agendamento.usersId } });
    const apiUrlMotorista = resolveWhatsappApiUrl(settingsMotorista);
    const apiTokenMotorista = resolveWhatsappApiToken(settingsMotorista);

    // Enviar mensagem para o motorista
    await axios.post(
      apiUrlMotorista,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phoneMotorista,
        type: "template",
        template: {
          name: templateNameMotorista,
          language: {
            code: "pt_BR",
          },
          components: [
            {
              type: "body",
              parameters: parametersMotorista,
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiTokenMotorista}`,
          "Content-Type": "application/json",
        },
      },
    );

    // Enviar mensagem para o cliente
    const templateNameCliente =
      status === "Buscar pet"
        ? "viapet_motoristabuscar"
        : "viapet_motoristaentrega";

    const parameterCliente = {
      type: "text",
      parameter_name: status === "Buscar pet" ? "nome" : "nome_cliente",
      text: agendamento.Custumer.name || "-",
    };

    await axios.post(
      apiUrlMotorista,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phoneCliente,
        type: "template",
        template: {
          name: templateNameCliente,
          language: {
            code: "pt_BR",
          },
          components: [
            {
              type: "body",
              parameters: [parameterCliente],
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiTokenMotorista}`,
          "Content-Type": "application/json",
        },
      },
    );

    return { success: true, message: "Mensagens enviadas com sucesso" };
  } catch (error) {
    console.error("Erro ao enviar mensagem para motorista e cliente:", error);
    throw error;
  }
}

export async function mensagemAgendamento(idAgendamento) {
  try {
    if (!idAgendamento) {
      return { success: false, error: "ID do agendamento é obrigatório" };
    }

    // Buscar o agendamento com todas as relações necessárias
    const agendamento = await Appointment.findByPk(idAgendamento, {
      include: [
        {
          model: Pets,
          attributes: ["name"],
        },
        {
          model: Custumers,
          attributes: ["name", "phone"],
        },
        {
          model: Services,
          attributes: ["name", "price"],
        },
      ],
    });

    if (!agendamento) {
      return { success: false, error: "Agendamento não encontrado" };
    }

    if (!agendamento.Custumer?.phone) {
      return {
        success: false,
        error: "Cliente não possui telefone cadastrado",
      };
    }

    const estabelecimento = await Settings.findOne({
      where: {
        usersId: agendamento.usersId,
      },
    });

    if (!estabelecimento) {
      return {
        success: false,
        error: "Configurações do estabelecimento não encontradas",
      };
    }

    // Formatação da data e hora
    const [ano, mes, dia] = agendamento.date.split("-");
    const [hora, minuto] = agendamento.time.split(":");
    const data = `${dia}/${mes}/${ano}`;
    const horario = `${hora}:${minuto}`;

    let phone = agendamento.Custumer.phone.replace(/\D/g, "");
    if (!phone.startsWith("55")) {
      phone = "55" + phone;
    }

    const response = await axios.post(
      resolveWhatsappApiUrl(estabelecimento),
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "template",
        template: {
          name: "viapet_agenda",
          language: {
            code: "pt_BR",
          },
          components: [
            {
              type: "body",
              parameters: [
                {
                  type: "text",
                  parameter_name: "nome",
                  text: agendamento.Custumer.name || "Cliente",
                },
                {
                  type: "text",
                  parameter_name: "estabelecimento",
                  text: estabelecimento.storeName || "Estabelecimento",
                },
                { type: "text", parameter_name: "data", text: data },
                { type: "text", parameter_name: "horario", text: horario },
                {
                  type: "text",
                  parameter_name: "servico",
                  text: agendamento.Service?.name || "Serviço não especificado",
                },
                {
                  type: "text",
                  parameter_name: "pet",
                  text: agendamento.Pet?.name || "Pet",
                },
                {
                  type: "text",
                  parameter_name: "valor",
                  text: agendamento.Service?.price?.toString() || "0",
                },
              ],
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${resolveWhatsappApiToken(estabelecimento)}`,
          "Content-Type": "application/json",
        },
      },
    );

    return { success: true, data: response.data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function mensagemPacotinho(idAgendamentos) {
  try {
    let customerName = "";
    let customerPhone = "";
    let estabelecimentoName = "";
    let estabelecimentoSettings = null;

    // Objeto para agrupar agendamentos por horário
    const agendamentosPorHorario = {};

    // Primeiro, vamos coletar todos os agendamentos e agrupá-los
    for (const id of idAgendamentos) {
      const agendamento = await Appointment.findByPk(id, {
        include: [
          {
            model: Pets,
            attributes: ["name"],
          },
          {
            model: Custumers,
            attributes: ["name", "phone"],
          },
          {
            model: Services,
            attributes: ["name"],
          },
        ],
      });

      if (!agendamento) continue;

      if (!customerName && agendamento.Custumer) {
        customerName = agendamento.Custumer.name;
        customerPhone = agendamento.Custumer.phone;

        const estabelecimento = await Settings.findOne({
          where: { usersId: agendamento.usersId },
        });
        estabelecimentoName = estabelecimento?.storeName || "";
        estabelecimentoSettings = estabelecimento;
      }

      const horario = agendamento.time;
      if (!agendamentosPorHorario[horario]) {
        agendamentosPorHorario[horario] = [];
      }
      agendamentosPorHorario[horario].push(agendamento);
    }

    // Agora vamos formatar o texto
    let agendamentosTexto = "📋 Agendamentos em Pacote";

    // Para cada horário diferente
    for (const horario in agendamentosPorHorario) {
      const agendamentos = agendamentosPorHorario[horario];
      const [hora, minuto] = horario.split(":");

      // Formatar as datas para este horário
      const datas = agendamentos.map((ag) => {
        const [ano, mes, dia] = ag.date.split("-");
        return `${dia}/${mes}`;
      });

      agendamentosTexto += `. 📅 Datas: ${datas.join(", ")}`;
      agendamentosTexto += `. ⏰ Horário: ${hora}:${minuto}`;

      // Adicionar informações do serviço se todos os agendamentos tiverem o mesmo serviço
      const servico = agendamentos[0].Service?.name;
      if (servico) {
        agendamentosTexto += `. 💇 Serviço: ${servico}`;
      }

      // Adicionar informações do pet
      const pet = agendamentos[0].Pet?.name;
      if (pet) {
        agendamentosTexto += `. 🐾 Pet: ${pet}`;
      }

      agendamentosTexto += ". ";
    }

    if (!agendamentosTexto) {
      throw new Error("Nenhum agendamento válido encontrado");
    }

    if (customerPhone && !customerPhone.startsWith("55")) {
      customerPhone = "55" + customerPhone;
    }

    const response = await axios.post(
      resolveWhatsappApiUrl(estabelecimentoSettings),
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: customerPhone,
        type: "template",
        template: {
          name: "viapet_pacotinho",
          language: {
            code: "pt_BR",
          },
          components: [
            {
              type: "body",
              parameters: [
                {
                  type: "text",
                  parameter_name: "nome",
                  text: customerName || "Cliente",
                },
                {
                  type: "text",
                  parameter_name: "agendamentos",
                  text: agendamentosTexto.trim(),
                },
              ],
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${resolveWhatsappApiToken(estabelecimentoSettings)}`,
        },
      },
    );
    return response.data;
  } catch (error) {
    console.error("Erro ao enviar mensagem de pacotinho:", error);
    throw error;
  }
}

export async function enviarMensagemAniversarioPet() {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    console.log(
      `\n[PET] Iniciando verificação de aniversários em ${hoje.toLocaleDateString()}`,
    );

    // Buscar pets que fazem aniversário hoje e não receberam mensagem este ano
    const pets = await Pets.findAll({
      where: {
        birthdate: {
          [Op.not]: null,
        },
        [Op.or]: [
          { lastParamsMessage: null },
          {
            lastParamsMessage: {
              [Op.lt]: new Date(hoje.getFullYear(), 0, 1),
            },
          },
        ],
      },
    });

    console.log(
      `[PET] Encontrados ${pets.length} pets com data de nascimento cadastrada`,
    );

    for (const pet of pets) {
      // Formata a data do pet para UTC
      const petBirthdate = new Date(pet.birthdate);
      petBirthdate.setHours(0, 0, 0, 0);

      console.log(
        `[PET] Verificando pet ${pet.name} - Data nasc: ${petBirthdate.toLocaleDateString()}`,
      );

      // Verifica se é aniversário hoje
      if (
        petBirthdate.getDate() === hoje.getDate() &&
        petBirthdate.getMonth() === hoje.getMonth()
      ) {
        console.log(`[PET] 🎉 ${pet.name} faz aniversário hoje!`);

        // Busca o cliente manualmente
        const customer = await Custumers.findOne({
          where: {
            id: pet.custumerId,
            status: true,
            phone: {
              [Op.not]: null,
              [Op.ne]: "",
            },
          },
        });

        if (!customer) {
          console.log(
            `[PET] ❌ Cliente não encontrado ou inválido para o pet ${pet.name}`,
          );
          continue;
        }

        console.log(`[PET] ✓ Cliente encontrado: ${customer.name}`);

        const settings = await Settings.findOne({
          where: {
            usersId: pet.usersId,
          },
        });

        let phone = customer.phone;
        if (!phone) {
          console.log(
            `[PET] ❌ Telefone inválido para o cliente ${customer.name}`,
          );
          continue;
        }

        if (phone && !phone.startsWith("55")) {
          phone = "55" + phone;
        }

        console.log(
          `[PET] 📱 Enviando mensagem para ${customer.name} (${phone}) sobre o pet ${pet.name}`,
        );

        await axios.post(
          resolveWhatsappApiUrl(settings),
          {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone,
            type: "template",
            template: {
              name: "viapet_pet",
              language: {
                code: "pt_BR",
              },
              components: [
                {
                  type: "body",
                  parameters: [
                    {
                      type: "text",
                      parameter_name: "pet",
                      text: pet.name,
                    },
                    {
                      type: "text",
                      parameter_name: "especie",
                      text: pet.species,
                    },
                    {
                      type: "text",
                      parameter_name: "petshop",
                      text: settings?.businessName || "Pet Shop",
                    },
                  ],
                },
              ],
            },
          },
          {
            headers: {
              Authorization: `Bearer ${resolveWhatsappApiToken(settings)}`,
            },
          },
        );

        console.log(
          `[PET] ✅ Mensagem enviada com sucesso para ${customer.name} sobre ${pet.name}`,
        );

        // Atualiza data do último envio
        await pet.update({
          lastParamsMessage: hoje,
        });
        console.log(
          `[PET] ✓ Data de última mensagem atualizada para ${pet.name}`,
        );
      } else {
        console.log(`[PET] ${pet.name} não faz aniversário hoje`);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("[PET] ❌ Erro ao enviar mensagens de aniversário:", error);
    throw error;
  }
}

export async function enviarMensagemAniversarioCliente() {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    console.log(
      `\n[CLIENTE] Iniciando verificação de aniversários em ${hoje.toLocaleDateString()}`,
    );

    // Buscar clientes que fazem aniversário hoje
    const clientes = await Custumers.findAll({
      where: {
        birthDate: {
          [Op.not]: null,
        },
        status: true,
        phone: {
          [Op.not]: null,
          [Op.ne]: "",
        },
        [Op.or]: [
          { lastBirthdayMessage: null },
          {
            lastBirthdayMessage: {
              [Op.lt]: new Date(hoje.getFullYear(), 0, 1),
            },
          },
        ],
      },
    });

    console.log(
      `[CLIENTE] Encontrados ${clientes.length} clientes com data de nascimento cadastrada`,
    );

    for (const cliente of clientes) {
      // Formata a data do cliente para UTC
      const clienteBirthdate = new Date(cliente.birthDate + "T00:00:00");
      clienteBirthdate.setHours(0, 0, 0, 0);

      console.log(
        `[CLIENTE] Verificando cliente ${cliente.name} - Data nasc: ${clienteBirthdate.toLocaleDateString()}`,
      );

      // Verifica se é aniversário hoje
      if (
        clienteBirthdate.getDate() === hoje.getDate() &&
        clienteBirthdate.getMonth() === hoje.getMonth()
      ) {
        console.log(`[CLIENTE] 🎉 ${cliente.name} faz aniversário hoje!`);

        const settings = await Settings.findOne({
          where: {
            usersId: cliente.usersId,
          },
        });

        const pet = await Pets.findOne({
          where: {
            custumerId: cliente.id,
          },
        });

        console.log(
          `[CLIENTE] ✓ Pet encontrado: ${pet?.name || "Nenhum pet encontrado"}`,
        );

        let phone = cliente.phone;
        if (!phone) {
          console.log(`[CLIENTE] ❌ Telefone inválido para ${cliente.name}`);
          continue;
        }

        if (phone && !phone.startsWith("55")) {
          phone = "55" + phone;
        }

        console.log(
          `[CLIENTE] 📱 Enviando mensagem para ${cliente.name} (${phone})`,
        );

        await axios.post(
          resolveWhatsappApiUrl(settings),
          {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone,
            type: "template",
            template: {
              name: "viapet_aniversariante",
              language: {
                code: "pt_BR",
              },
              components: [
                {
                  type: "body",
                  parameters: [
                    {
                      type: "text",
                      parameter_name: "tutor",
                      text: cliente.name,
                    },
                    {
                      type: "text",
                      parameter_name: "petshop",
                      text: settings?.businessName || "Pet Shop",
                    },
                    {
                      type: "text",
                      parameter_name: "pet",
                      text: pet?.name || "seu pet",
                    },
                  ],
                },
              ],
            },
          },
          {
            headers: {
              Authorization: `Bearer ${resolveWhatsappApiToken(settings)}`,
            },
          },
        );

        console.log(
          `[CLIENTE] ✅ Mensagem enviada com sucesso para ${cliente.name}`,
        );

        // Atualiza data do último envio
        await cliente.update({
          lastBirthdayMessage: hoje,
        });
        console.log(
          `[CLIENTE] ✓ Data de última mensagem atualizada para ${cliente.name}`,
        );
      } else {
        console.log(`[CLIENTE] ${cliente.name} não faz aniversário hoje`);
      }
    }

    return { success: true };
  } catch (error) {
    console.error(
      "[CLIENTE] ❌ Erro ao enviar mensagens de aniversário para clientes:",
      error,
    );
    throw error;
  }
}

// Configura o cronjob para rodar todos os dias às 8:00
import cron from "node-cron";

function normalizeWhatsappDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function buildPhoneVariations(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return [];

  const withCountry = normalizeWhatsappDigits(digits);
  const withoutCountry = withCountry.startsWith("55")
    ? withCountry.slice(2)
    : withCountry;
  const withNinthDigit = withoutCountry.replace(/^(\d{2})(\d{8})$/, "$19$2");
  const withoutNinthDigit = withoutCountry.replace(/^(\d{2})9(\d{8})$/, "$1$2");

  return Array.from(
    new Set(
      [
        digits,
        withCountry,
        withoutCountry,
        withNinthDigit,
        withoutNinthDigit,
        normalizeWhatsappDigits(withNinthDigit),
        normalizeWhatsappDigits(withoutNinthDigit),
      ].filter(Boolean),
    ),
  );
}

function extractInboundMessageBody(message = {}) {
  if (message?.text?.body) return message.text.body;
  if (message?.image?.caption) return message.image.caption;
  if (message?.video?.caption) return message.video.caption;
  if (message?.document?.caption) return message.document.caption;
  if (message?.button?.text) return message.button.text;
  if (message?.interactive?.button_reply?.title) {
    return message.interactive.button_reply.title;
  }
  if (message?.interactive?.list_reply?.title) {
    return message.interactive.list_reply.title;
  }
  return `[${message?.type || "mensagem"}]`;
}

async function resolveWebhookEstablishmentId(phoneNumberId) {
  if (!phoneNumberId) return null;

  const settingsList = await Settings.findAll({
    attributes: ["usersId", "whatsappConnection"],
  });

  const match = settingsList.find(
    (item) =>
      String(item?.whatsappConnection?.phoneNumberId || "").trim() ===
      String(phoneNumberId).trim(),
  );

  return match?.usersId || null;
}

async function syncInboundConversation({
  customer = null,
  usersId = null,
  from = "",
  message = {},
  body = "",
  contactName = "",
  payload = {},
}) {
  const resolvedUsersId = customer?.usersId || usersId || null;
  if (!resolvedUsersId) {
    return null;
  }

  const normalizedPhone = normalizeWhatsappDigits(from);
  const pet = customer?.id
    ? await Pets.findOne({
        where: {
          usersId: resolvedUsersId,
          custumerId: customer.id,
        },
        order: [
          ["updatedAt", "DESC"],
          ["createdAt", "DESC"],
        ],
      })
    : null;

  const existingConversation = await CrmConversation.findOne({
    where: {
      usersId: resolvedUsersId,
      isArchived: false,
      [Op.or]: [
        ...(customer?.id ? [{ customerId: customer.id }] : []),
        ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
      ],
    },
    order: [
      ["lastMessageAt", "DESC"],
      ["updatedAt", "DESC"],
    ],
  });

  if (message?.id && existingConversation) {
    const duplicateMessage = await CrmConversationMessage.findOne({
      where: {
        usersId: resolvedUsersId,
        conversationId: existingConversation.id,
        providerMessageId: message.id,
      },
    });

    if (duplicateMessage) {
      return existingConversation;
    }
  }

  const now = new Date();
  const title =
    customer?.name ||
    contactName ||
    normalizedPhone ||
    "Nova conversa";
  const preview = body || `[${message?.type || "mensagem"}]`;

  const conversation = existingConversation
    ? await existingConversation.update({
        customerId: customer?.id || existingConversation.customerId,
        petId: pet?.id || existingConversation.petId,
        customerName: customer?.name || existingConversation.customerName,
        petName: pet?.name || existingConversation.petName,
        phone: normalizedPhone || existingConversation.phone,
        title: existingConversation.title || title,
        source: "whatsapp-webhook",
        channel: "whatsapp",
        lastMessagePreview: preview,
        lastMessageAt: now,
        lastInboundAt: now,
        unreadCount: Number(existingConversation.unreadCount || 0) + 1,
        status:
          String(existingConversation.status || "").toLowerCase() === "closed"
            ? "pending"
            : existingConversation.status || "pending",
        metadata: {
          ...(existingConversation.metadata || {}),
          lastInboundSource: "webhook",
          lastInboundMessageId: message?.id || null,
          lastInboundMessageType: message?.type || "text",
        },
      })
    : await CrmConversation.create({
        usersId: resolvedUsersId,
        customerId: customer?.id || null,
        petId: pet?.id || null,
        channel: "whatsapp",
        status: "pending",
        source: "whatsapp-webhook",
        title,
        customerName: customer?.name || null,
        petName: pet?.name || null,
        phone: normalizedPhone,
        lastMessagePreview: preview,
        lastMessageAt: now,
        lastInboundAt: now,
        unreadCount: 1,
        metadata: {
          lastInboundSource: "webhook",
          lastInboundMessageId: message?.id || null,
          lastInboundMessageType: message?.type || "text",
        },
      });

  await CrmConversationMessage.create({
    conversationId: conversation.id,
    usersId: resolvedUsersId,
    customerId: customer?.id || null,
    petId: pet?.id || null,
    direction: "inbound",
    channel: "whatsapp",
    messageType: message?.type || "text",
    body: body || null,
    providerMessageId: message?.id || null,
    status: "received",
    receivedAt: now,
    payload,
  });

  return conversation;
}

// Agenda as tarefas para rodar às 8:00 todos os dias
cron.schedule(
  "0 8 * * *",
  async () => {
    try {
      console.log("Iniciando envio de mensagens de aniversário...");
      await enviarMensagemAniversarioPet();
      await enviarMensagemAniversarioCliente();
      console.log("Envio de mensagens de aniversário concluído com sucesso");
    } catch (error) {
      console.error(
        "Erro ao executar envio de mensagens de aniversário:",
        error,
      );
    }
  },
  {
    scheduled: true,
    timezone: "America/Sao_Paulo",
  },
);

// Webhook para receber notificações do WhatsApp API
const webhookHandler = async (req, res) => {
  try {
    // Verifica a chave de segurança
    const token = req.query["hub.verify_token"];
    const envVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "genius";
    const settingsList = await Settings.findAll({
      attributes: ["whatsappConnection"],
    }).catch(() => []);
    const settingsMatch = (settingsList || []).some(
      (item) =>
        String(item?.whatsappConnection?.verifyToken || "").trim() ===
        String(token || "").trim(),
    );

    if (token === envVerifyToken || settingsMatch) {
      // Responde ao desafio de verificação do WhatsApp
      const challenge = req.query["hub.challenge"];
      return res.status(200).send(challenge);
    }

    // Chave inválida
    return res.status(403).send("Forbidden");
  } catch (error) {
    console.error("Erro no webhook do WhatsApp:", error);
    return res.status(500).send("Internal Server Error");
  }
};

// Rota do webhook
router.get("/webhook", webhookHandler);
router.post("/webhook", async (req, res) => {
  try {
    console.log("Webhook recebido:", JSON.stringify(req.body, null, 2));

    if (!req.body || !req.body.entry || !req.body.entry[0]) {
      console.log("Payload inválido recebido");
      return res.sendStatus(400);
    }

    const entry = req.body.entry[0];

    if (!entry.changes || !entry.changes[0] || !entry.changes[0].value) {
      console.log("Estrutura de changes inválida");
      return res.sendStatus(200);
    }

    const value = entry.changes[0].value;

    if (!value.messages || !value.messages[0]) {
      console.log("Nenhuma mensagem encontrada no payload");
      return res.sendStatus(200);
    }

    const message = value.messages[0];
    const phone_number_id = value.metadata.phone_number_id;
    const from = message.from;
    const contactName = value.contacts?.[0]?.profile?.name || "";
    const msg_body = extractInboundMessageBody(message);
    const resolvedUsersId = await resolveWebhookEstablishmentId(phone_number_id);

    // Verifica se é uma mensagem inicial do cliente
    const isInitialMessage = message.type === "text" && !message.context;

    if (isInitialMessage) {
      console.log("Mensagem inicial detectada");

      // Busca as variações do número de telefone
      const phoneVariations = [
        from,
        from.replace("55", ""),
        "55" + from,
        from.replace("+", ""),
        // Adiciona variações com e sem o 9 após o DDD
        from.replace(/^(\d{4})/, "$19"), // Adiciona 9 após DDD
        from.replace(/^(\d{4})9/, "$1"), // Remove 9 após DDD
        from.replace("55", "").replace(/^(\d{2})/, "$19"), // Sem 55 e com 9
        from.replace("55", "").replace(/^(\d{2})9/, "$1"), // Sem 55 e sem 9
        "55" + from.replace(/^(\d{2})/, "$19"), // Com 55 e com 9
        "55" + from.replace(/^(\d{2})9/, "$1"), // Com 55 e sem 9
      ];

      console.log("Buscando cliente com as variações:", phoneVariations);

      // Busca o cliente pelo número de telefone
      const customer = await Custumers.findOne({
        where: {
          phone: {
            [Op.in]: phoneVariations,
          },
        },
      });

      if (customer) {
        console.log("Cliente encontrado:", customer.id);

        // Busca o estabelecimento vinculado ao cliente
        const estabelecimento = await Users.findByPk(customer.usersId);

        await CrmWhatsappMessage.create({
          usersId: customer.usersId,
          customerId: customer.id,
          customerName: customer.name,
          phone: from,
          direction: "inbound",
          channel: "whatsapp",
          messageType: message.type || "text",
          body: msg_body || "",
          whatsappMessageId: message.id || null,
          status: "received",
          receivedAt: new Date(),
          payload: req.body,
        });

        await syncInboundConversation({
          customer,
          from,
          message,
          body: msg_body || "",
          contactName,
          payload: req.body,
        });

        if (estabelecimento) {
          // Remove todos os caracteres não numéricos
          let formattedPhone = estabelecimento.phone?.replace(/\D/g, "") || "";

          // Garante que o número está no formato correto (557499835227)
          if (formattedPhone.length === 8) {
            formattedPhone = "5574" + formattedPhone;
          } else if (formattedPhone.length === 10) {
            formattedPhone = "55" + formattedPhone;
          } else if (formattedPhone.length === 11) {
            formattedPhone = "55" + formattedPhone;
          } else if (formattedPhone.length === 13) {
            // Remove o primeiro 9 que aparecer após o DDD
            formattedPhone =
              formattedPhone.slice(0, 4) +
              formattedPhone.slice(4).replace("9", "");
          } else if (!formattedPhone.startsWith("55")) {
            formattedPhone = "55" + formattedPhone;
          }

          // Cria as variações do número
          const phoneVariations = [
            formattedPhone,
            formattedPhone.slice(2),
            formattedPhone.slice(2).replace(/^(\d{2})/, "$1"),
          ];

          let waId = formattedPhone;

          // Busca as configurações do estabelecimento
          const settings = await Settings.findOne({
            where: { usersId: estabelecimento.id },
          });

          if (settings) {
            settings.whatsappConnection = {
              ...(settings.whatsappConnection || {}),
              provider:
                settings.whatsappConnection?.provider || "WhatsApp Cloud API",
              phoneNumberId:
                settings.whatsappConnection?.phoneNumberId || phone_number_id,
              verifyToken:
                settings.whatsappConnection?.verifyToken ||
                process.env.WHATSAPP_VERIFY_TOKEN ||
                "genius",
              accessTokenConfigured: Boolean(
                settings.whatsappConnection?.accessTokenConfigured ||
                  process.env.WHATSAPP_TOKEN,
              ),
              lastWebhookAt: new Date().toISOString(),
              lastInboundPhone: from,
            };
            await settings.save();
          }

          if (settings?.notifyClient) {
            console.log("Enviando mensagem automática...");
            const webhookApiUrl = resolveWhatsappApiUrl(settings);
            const webhookApiToken = resolveWhatsappApiToken(settings);

            try {
              // Envia mensagem informando que é um número de automação
              await axios.post(
                webhookApiUrl,
                {
                  messaging_product: "whatsapp",
                  to: from,
                  type: "text",
                  text: {
                    body: `🐾 Olá! Que bom ter você por aqui! 🌟\n\nEste é um número exclusivo para automações do ViaPet 🤖\n\nPara falar diretamente com ${settings.storeName || "Pet Shop"} 🏪, use o contato abaixo:\n\n⬇️ ⬇️ ⬇️`,
                  },
                },
                {
                  headers: {
                    Authorization: `Bearer ${webhookApiToken}`,
                    "Content-Type": "application/json",
                  },
                },
              );

              // Envia o contato do estabelecimento
              const response = await axios.post(
                webhookApiUrl,
                {
                  messaging_product: "whatsapp",
                  recipient_type: "individual",
                  to: from,
                  type: "contacts",
                  contacts: [
                    {
                      name: {
                        formatted_name: settings.storeName || "Pet Shop",
                        first_name: settings.storeName || "Pet Shop",
                      },
                      phones: [
                        {
                          phone: formattedPhone,
                          type: "WORK",
                          wa_id: formattedPhone,
                        },
                      ],
                    },
                  ],
                },
                {
                  headers: {
                    Authorization: `Bearer ${webhookApiToken}`,
                    "Content-Type": "application/json",
                  },
                },
              );

              console.log("Resposta da API WhatsApp:", response.data);
              console.log(
                `Mensagem automática enviada com sucesso para ${from}`,
              );
            } catch (apiError) {
              console.error(
                "Erro ao enviar mensagem via API:",
                apiError.response?.data || apiError,
              );
            }
          }
        }
      } else {
        console.log("Nenhum cliente encontrado para o número:", from);

        await syncInboundConversation({
          usersId: resolvedUsersId,
          from,
          message,
          body: msg_body || "",
          contactName,
          payload: req.body,
        });
      }
    } else {
      await syncInboundConversation({
        usersId: resolvedUsersId,
        from,
        message,
        body: msg_body || "",
        contactName,
        payload: req.body,
      });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook:", error);
    res.sendStatus(500);
  }
});

export default router;
