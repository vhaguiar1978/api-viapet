import nodemailer from "nodemailer";
import Admin from "../models/Admin.js";
import cron from "node-cron";
import { Op } from "sequelize";
import Users from "../models/Users.js";
import EmailCampaign from "../models/EmailCampaign.js";
import EmailCampaignLog from "../models/EmailCampaignLog.js";

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeCronJobs();
  }

  normalizeFrontendUrl(url) {
    const rawUrl = String(url || "").trim();
    if (!rawUrl) {
      return "https://app.viapet.app";
    }

    const normalizedRawUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

    let parsedUrl = null;
    try {
      parsedUrl = new URL(normalizedRawUrl);
    } catch (_error) {
      return normalizedRawUrl.replace(/\/+$/, "");
    }

    const hostname = String(parsedUrl.hostname || "").toLowerCase();
    if (
      hostname === "viapet.app" ||
      hostname === "www.viapet.app" ||
      hostname === "api.viapet.app"
    ) {
      return "https://app.viapet.app";
    }

    return parsedUrl.toString().replace(/\/+$/, "");
  }

  buildPartnerLandingLink() {
    const explicitLandingUrl =
      process.env.PUBLIC_SITE_URL ||
      process.env.MARKETING_URL ||
      process.env.WEBSITE_URL ||
      "";

    if (explicitLandingUrl) {
      return this.normalizeFrontendUrl(explicitLandingUrl);
    }

    const frontendUrl = this.normalizeFrontendUrl(process.env.FRONTEND_URL);
    if (/^https?:\/\/app\.viapet\.app$/i.test(frontendUrl)) {
      return "https://viapet.app";
    }

    return frontendUrl || "https://viapet.app";
  }

  buildPasswordResetLink(token) {
    const frontendUrl = this.normalizeFrontendUrl(process.env.FRONTEND_URL);
    return `${frontendUrl}/redefinir-senha?token=${token}`;
  }

  resolveEmailVariables(content, user = {}) {
    const replacements = {
      "{nome_cliente}": user.name || "",
      "{email_cliente}": user.email || "",
      "{telefone_cliente}": user.phone || "",
      "{nome_empresa}": "ViaPet",
    };

    return Object.entries(replacements).reduce(
      (current, [needle, value]) => current.split(needle).join(String(value || "")),
      String(content || ""),
    );
  }

  computeNextCampaignRun(campaign, baseDate = new Date()) {
    if (!campaign?.automaticEnabled || campaign?.status !== "active") {
      return null;
    }

    const [rawHour, rawMinute] = String(campaign.sendTime || "09:00").split(":");
    const hour = Number(rawHour || 9);
    const minute = Number(rawMinute || 0);

    if (campaign.scheduleType === "interval") {
      const lastRun = campaign.lastRunAt ? new Date(campaign.lastRunAt) : new Date(baseDate);
      const next = new Date(lastRun);
      next.setDate(next.getDate() + Math.max(1, Number(campaign.frequencyDays || 7)));
      next.setHours(hour, minute, 0, 0);
      if (next <= baseDate && !campaign.lastRunAt) {
        next.setDate(baseDate.getDate());
        next.setHours(hour, minute, 0, 0);
        if (next <= baseDate) {
          next.setDate(next.getDate() + Math.max(1, Number(campaign.frequencyDays || 7)));
        }
      }
      return next;
    }

    const sendDays = Array.isArray(campaign.sendDaysOfWeek)
      ? campaign.sendDaysOfWeek.map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [];
    const validDays = sendDays.length ? sendDays : [baseDate.getDay()];
    const next = new Date(baseDate);
    next.setSeconds(0, 0);
    next.setHours(hour, minute, 0, 0);

    for (let offset = 0; offset < 8; offset += 1) {
      const candidate = new Date(baseDate);
      candidate.setDate(candidate.getDate() + offset);
      candidate.setHours(hour, minute, 0, 0);
      if (!validDays.includes(candidate.getDay())) continue;
      if (candidate > baseDate) {
        return candidate;
      }
    }

    const fallback = new Date(baseDate);
    fallback.setDate(fallback.getDate() + 7);
    fallback.setHours(hour, minute, 0, 0);
    return fallback;
  }

  async getMailSettings() {
    const settings = await Admin.findOne();
    const smtpPort =
      Number(settings?.smtpPort || process.env.SMTP_PORT || process.env.MAIL_PORT || 0) || null;
    const mailSettings = {
      smtpHost: settings?.smtpHost || process.env.SMTP_HOST || process.env.MAIL_HOST || "",
      smtpPort,
      smtpEmail: settings?.smtpEmail || process.env.SMTP_EMAIL || process.env.MAIL_USER || "",
      smtpPassword:
        settings?.smtpPassword || process.env.SMTP_PASSWORD || process.env.MAIL_PASS || "",
    };

    if (
      !mailSettings.smtpHost ||
      !mailSettings.smtpPort ||
      !mailSettings.smtpEmail ||
      !mailSettings.smtpPassword
    ) {
      throw new Error(
        "As configuracoes de email nao estao completas. Cadastre SMTP no painel administrativo."
      );
    }

    return mailSettings;
  }

  async ensurePasswordResetTransporter() {
    const settings = await this.getMailSettings();

    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: settings.smtpHost,
        port: settings.smtpPort,
        secure: settings.smtpPort === 465,
        auth: {
          user: settings.smtpEmail,
          pass: settings.smtpPassword,
        },
        connectionTimeout: 10000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
        pool: true,
        maxConnections: 1,
        maxMessages: 10,
        rateLimit: 1,
      });
    }

    return settings;
  }

  async ensureCampaignTransporter() {
    return this.ensurePasswordResetTransporter();
  }

  async initializeTransporter() {
    try {
      const settings = await Admin.findOne();
      const partnerLandingLink = this.buildPartnerLandingLink();

      if (!settings) {
        throw new Error("Configurações de SMTP não encontradas");
      }

      this.transporter = nodemailer.createTransport({
        host: settings.smtpHost,
        port: settings.smtpPort,
        secure: settings.smtpPort === 465,
        auth: {
          user: settings.smtpEmail,
          pass: settings.smtpPassword,
        },
        // Configurações de timeout e retry para evitar travamento
        connectionTimeout: 10000, // 10 segundos
        greetingTimeout: 5000, // 5 segundos para greeting
        socketTimeout: 10000, // 10 segundos para socket
        pool: true,
        maxConnections: 1,
        maxMessages: 10,
        rateLimit: 1, // 1 email por segundo
      });

      // Verificação com timeout
      const verifyPromise = this.transporter.verify();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Timeout na verificação SMTP")),
          8000
        );
      });

      await Promise.race([verifyPromise, timeoutPromise]);
      console.log("✅ Transportador SMTP verificado com sucesso");
      return this.transporter;
    } catch (error) {
      console.error("Erro ao inicializar transportador de email:", error);
      this.transporter = null; // Reset transporter em caso de erro
      throw error;
    }
  }

  async sendPasswordResetEmail(recipientEmail, token) {
    try {
      const settings = await this.ensurePasswordResetTransporter();
      const resetLink = this.buildPasswordResetLink(token);

      const mailOptions = {
        from: settings.smtpEmail,
        to: recipientEmail,
        subject: "Redefinição de Senha",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Redefinição de Senha</h2>
            <p>Olá,</p>
            <p>Recebemos uma solicitação para redefinir sua senha.</p>
            <p>Para criar uma nova senha, clique no link abaixo:</p>
            <p>
              <a href="${resetLink}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">
                Redefinir Senha
              </a>
            </p>
            <p style="font-size: 13px; color: #666; word-break: break-all;">
              Se o botao nao abrir, copie e cole este link no navegador: ${resetLink}
            </p>
            <p>Este link é válido por 1 hora.</p>
            <p>Se você não solicitou a redefinição de senha, ignore este email.</p>
            <br>
            <p>Atenciosamente,</p>
            <p><strong>Equipe do Sistema</strong></p>
          </div>
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);
      return info;
    } catch (error) {
      console.error("Erro ao enviar email de redefinição de senha:", error);
      throw error;
    }
  }

  async sendAdminTestEmail(recipientEmail) {
    const settings = await this.ensurePasswordResetTransporter();
    return this.transporter.sendMail({
      from: settings.smtpEmail,
      to: recipientEmail,
      subject: "Teste de e-mail ViaPet",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>SMTP configurado com sucesso</h2>
          <p>Este e-mail confirma que o servidor de envio do ViaPet esta respondendo normalmente.</p>
          <p>Data do teste: ${new Date().toLocaleString("pt-BR")}</p>
        </div>
      `,
      text: `SMTP configurado com sucesso. Data do teste: ${new Date().toLocaleString("pt-BR")}`,
    });
  }

  async sendWelcomeEmail(userId, recipientEmail) {
    // Executa o envio de forma assíncrona para não travar o servidor
    this.sendEmailSafely(async () => {
      try {
        if (!this.transporter) {
          await this.initializeTransporter();
        }

        const settings = await Admin.findOne();

        const mailOptions = {
          from: settings.smtpEmail,
          to: recipientEmail,
          subject: "Bem-vindo!",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Bem-vindo ao Nosso Sistema!</h2>
              <p>Olá,</p>
              <p>É com grande satisfação que damos as boas-vindas a você em nossa plataforma.</p>
              <p>Estamos muito felizes em tê-lo(a) conosco e esperamos proporcionar a melhor experiência possível.</p>
              <p>Se precisar de ajuda ou tiver alguma dúvida, não hesite em nos contatar.</p>
              <br>
              <p>Atenciosamente,</p>
              <p><strong>Equipe do Sistema</strong></p>
            </div>
          `,
        };

        const info = await this.transporter.sendMail(mailOptions);
        console.log(
          "✅ Email de boas-vindas enviado com sucesso:",
          info.messageId
        );
        return info;
      } catch (error) {
        console.error("❌ Erro ao enviar email de boas-vindas:", error.message);
        // Não propaga o erro para não afetar o registro do usuário
        return null;
      }
    });
  }

  // Método auxiliar para envio seguro de emails
  async sendEmailSafely(emailFunction) {
    try {
      // Executa de forma assíncrona sem bloquear
      setImmediate(async () => {
        try {
          await emailFunction();
        } catch (error) {
          console.error("❌ Erro no envio assíncrono de email:", error.message);
          // Log do erro mas não afeta o fluxo principal
        }
      });
    } catch (error) {
      console.error("❌ Erro ao agendar envio de email:", error.message);
    }
  }

  async sendLoginNotificationEmail(recipientEmail, name) {
    try {
      if (!this.transporter) {
        await this.initializeTransporter();
      }

      const settings = await Admin.findOne();

      const mailOptions = {
        from: settings.smtpEmail,
        to: recipientEmail,
        subject: "Novo Acesso Detectado",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Novo Acesso à Sua Conta</h2>
            <p>Olá ${name},</p>
            <p>Detectamos um novo acesso à sua conta em ${new Date().toLocaleString(
              "pt-BR"
            )}.</p>
            <p>Se foi você, pode ignorar este email.</p>
            <p>Se não foi você, recomendamos que altere sua senha imediatamente.</p>
            <br>
            <p>Atenciosamente,</p>
            <p><strong>Equipe do Sistema</strong></p>
          </div>
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);
      return info;
    } catch (error) {
      console.error("Erro ao enviar email de notificação de login:", error);
      throw error;
    }
  }

  async sendEmployeeWelcomeEmail(recipientEmail, name, establishmentName) {
    // Executa o envio de forma assíncrona para não travar o servidor
    this.sendEmailSafely(async () => {
      try {
        if (!this.transporter) {
          await this.initializeTransporter();
        }

        const settings = await Admin.findOne();

        const mailOptions = {
          from: settings.smtpEmail,
          to: recipientEmail,
          subject: "Bem-vindo à Equipe!",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Bem-vindo à Equipe!</h2>
              <p>Olá ${name},</p>
              <p>Você foi adicionado como funcionário no estabelecimento ${establishmentName}.</p>
              <p>Para acessar o sistema, utilize seu email e crie uma senha no primeiro acesso.</p>
              <p>Se precisar de ajuda, entre em contato com o administrador do estabelecimento.</p>
              <br>
              <p>Atenciosamente,</p>
              <p><strong>Equipe do Sistema</strong></p>
            </div>
          `,
        };

        const info = await this.transporter.sendMail(mailOptions);
        console.log(
          "✅ Email de boas-vindas para funcionário enviado com sucesso:",
          info.messageId
        );
        return info;
      } catch (error) {
        console.error(
          "❌ Erro ao enviar email de boas-vindas para funcionário:",
          error.message
        );
        // Não propaga o erro para não afetar o cadastro do funcionário
        return null;
      }
    });
  }

  async sendEmployeeLoginNotificationEmail(
    recipientEmail,
    name,
    establishmentName
  ) {
    // Executa o envio de forma assíncrona para não travar o servidor
    this.sendEmailSafely(async () => {
      try {
        if (!this.transporter) {
          await this.initializeTransporter();
        }

        const settings = await Admin.findOne();

        const mailOptions = {
          from: settings.smtpEmail,
          to: recipientEmail,
          subject: "Novo Acesso Detectado",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Novo Acesso à Sua Conta</h2>
              <p>Olá ${name},</p>
              <p>Detectamos um novo acesso à sua conta de funcionário do estabelecimento ${establishmentName} em ${new Date().toLocaleString(
            "pt-BR"
          )}.</p>
              <p>Se foi você, pode ignorar este email.</p>
              <p>Se não foi você, entre em contato com o administrador do estabelecimento.</p>
              <br>
              <p>Atenciosamente,</p>
              <p><strong>Equipe do Sistema</strong></p>
            </div>
          `,
        };

        const info = await this.transporter.sendMail(mailOptions);
        console.log(
          "✅ Email de notificação de login enviado com sucesso:",
          info.messageId
        );
        return info;
      } catch (error) {
        console.error(
          "❌ Erro ao enviar email de notificação de login para funcionário:",
          error.message
        );
        // Não propaga o erro para não afetar o login
        return null;
      }
    });
  }

  async sendPlanExpirationEmail(user) {
    try {
      if (!this.transporter) {
        await this.initializeTransporter();
      }

      const settings = await Admin.findOne();

      const mailOptions = {
        from: settings.smtpEmail,
        to: user.email,
        subject: "🎉 Oferta Especial - Não perca essa oportunidade!",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; border-radius: 10px;">
            <div style="text-align: center; background-color: #4CAF50; padding: 20px; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0;">Oferta Especial para Você!</h1>
            </div>

            <div style="background-color: white; padding: 20px; border-radius: 0 0 10px 10px;">
              <p style="font-size: 16px;">Olá ${user.name},</p>

              <p style="font-size: 16px;">Notamos que seu plano está próximo do vencimento e preparamos uma oferta especial para você!</p>

              <div style="background-color: #f5f5f5; padding: 20px; border-radius: 10px; margin: 20px 0; text-align: center;">
                <h2 style="color: #4CAF50; margin: 0;">Plano Premium por apenas</h2>
                <div style="font-size: 48px; color: #4CAF50; font-weight: bold; margin: 10px 0;">
                  R$ 69,90<span style="font-size: 24px;">/mês</span>
                </div>
                <p style="font-size: 18px; color: #666;">Economize e mantenha seu negócio crescendo!</p>
              </div>

              <ul style="list-style: none; padding: 0;">
                <li style="margin: 10px 0;">
                  <span style="color: #4CAF50; margin-right: 10px;">✓</span>
                  Acesso completo a todas as funcionalidades
                </li>
                <li style="margin: 10px 0;">
                  <span style="color: #4CAF50; margin-right: 10px;">✓</span>
                  Suporte prioritário
                </li>
                <li style="margin: 10px 0;">
                  <span style="color: #4CAF50; margin-right: 10px;">✓</span>
                  Atualizações exclusivas
                </li>
              </ul>

              <p style="font-size: 16px; color: #666;">Não perca essa oportunidade única! Entre em contato conosco para aproveitar esta oferta especial.</p>

              <div style="text-align: center; margin-top: 30px;">
                <a href="${partnerLandingLink}" target="_blank" rel="noopener noreferrer" style="background-color: #4CAF50; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">APROVEITAR AGORA</a>
              </div>

              <p style="font-size: 13px; color: #777; margin-top: 18px; word-break: break-all;">
                Se o botão não abrir, copie e cole este link no navegador: ${partnerLandingLink}
              </p>

              <p style="font-size: 14px; color: #999; margin-top: 30px; text-align: center;">
                Esta oferta é válida por tempo limitado. Em caso de dúvidas, entre em contato com nosso suporte.
              </p>
            </div>
          </div>
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);
      return info;
    } catch (error) {
      console.error("Erro ao enviar email de promoção:", error);
      throw error;
    }
  }

  async checkExpiringPlans() {
    try {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      const users = await Users.findAll({
        where: {
          role: "proprietario",
          expirationDate: {
            [Op.and]: [
              { [Op.lte]: thirtyDaysFromNow },
              { [Op.gte]: new Date() },
            ],
          },
        },
      });

      for (const user of users) {
        await this.sendPlanExpirationEmail(user);
      }
    } catch (error) {
      console.error("Erro ao verificar planos:", error);
    }
  }

  async getCampaignRecipients(campaign) {
    const targetMode = String(campaign?.targetMode || "all").toLowerCase();
    const selectedIds = Array.isArray(campaign?.selectedClientIds)
      ? campaign.selectedClientIds.map((item) => String(item || "").trim()).filter(Boolean)
      : [];

    const where = {
      role: "proprietario",
      email: {
        [Op.ne]: null,
      },
    };

    if (targetMode === "selected" && selectedIds.length) {
      where.id = {
        [Op.in]: selectedIds,
      };
    }

    return Users.findAll({
      where,
      attributes: ["id", "name", "email", "phone"],
      order: [["name", "ASC"]],
    });
  }

  buildCampaignHtml(campaign, user) {
    const resolvedHtml = this.resolveEmailVariables(campaign?.contentHtml || "", user);
    const resolvedText = this.resolveEmailVariables(campaign?.contentText || "", user);
    const previewText = this.resolveEmailVariables(campaign?.previewText || "", user);

    if (resolvedHtml.trim()) {
      return `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #2f2045;">
          ${previewText ? `<p style="font-size:12px;color:#8a7ca1;margin:0 0 18px;">${previewText}</p>` : ""}
          ${resolvedHtml}
        </div>
      `;
    }

    return `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #2f2045;">
        ${previewText ? `<p style="font-size:12px;color:#8a7ca1;margin:0 0 18px;">${previewText}</p>` : ""}
        <pre style="white-space: pre-wrap; font-family: Arial, sans-serif; line-height: 1.6;">${resolvedText}</pre>
      </div>
    `;
  }

  async sendCampaignEmailToUser(campaign, user) {
    const settings = await this.ensureCampaignTransporter();
    const subject = this.resolveEmailVariables(campaign?.subject || "", user);
    const html = this.buildCampaignHtml(campaign, user);
    const text = this.resolveEmailVariables(
      campaign?.contentText || campaign?.contentHtml?.replace(/<[^>]+>/g, " ") || "",
      user,
    );

    try {
      const info = await this.transporter.sendMail({
        from: settings.smtpEmail,
        to: user.email,
        subject,
        html,
        text,
      });

      await EmailCampaignLog.create({
        campaignId: campaign.id,
        userId: user.id,
        recipientEmail: user.email,
        recipientName: user.name,
        subject,
        status: "sent",
        metadata: {
          messageId: info?.messageId || null,
          mode: campaign.automaticEnabled ? "automatic" : "manual",
        },
        sentAt: new Date(),
      });

      return { success: true, info };
    } catch (error) {
      await EmailCampaignLog.create({
        campaignId: campaign.id,
        userId: user.id,
        recipientEmail: user.email,
        recipientName: user.name,
        subject,
        status: "failed",
        errorMessage: error.message,
        metadata: {
          mode: campaign.automaticEnabled ? "automatic" : "manual",
        },
        sentAt: new Date(),
      });

      return { success: false, error };
    }
  }

  async sendEmailCampaignNow(campaignInput) {
    const campaign =
      typeof campaignInput === "string"
        ? await EmailCampaign.findByPk(campaignInput)
        : campaignInput;

    if (!campaign) {
      throw new Error("Campanha de e-mail nao encontrada.");
    }

    const recipients = await this.getCampaignRecipients(campaign);
    if (!recipients.length) {
      throw new Error("Nenhum cliente com e-mail encontrado para esta campanha.");
    }

    const results = await Promise.all(
      recipients.map((user) => this.sendCampaignEmailToUser(campaign, user)),
    );

    const sentCount = results.filter((item) => item.success).length;
    const failedCount = results.length - sentCount;
    const nextRunAt = this.computeNextCampaignRun(campaign, new Date());

    await campaign.update({
      lastRunAt: new Date(),
      nextRunAt,
    });

    return {
      sentCount,
      failedCount,
      totalRecipients: recipients.length,
      nextRunAt,
    };
  }

  async processScheduledCampaigns() {
    try {
      const now = new Date();
      const campaigns = await EmailCampaign.findAll({
        where: {
          automaticEnabled: true,
          status: "active",
          nextRunAt: {
            [Op.lte]: now,
          },
        },
        order: [["nextRunAt", "ASC"]],
      });

      for (const campaign of campaigns) {
        try {
          await this.sendEmailCampaignNow(campaign);
        } catch (error) {
          console.error(`Erro ao processar campanha automatica ${campaign.id}:`, error);
          await campaign.update({
            nextRunAt: this.computeNextCampaignRun(
              campaign,
              new Date(Date.now() + 30 * 60 * 1000),
            ),
          });
        }
      }
    } catch (error) {
      console.error("Erro ao processar campanhas automáticas de e-mail:", error);
    }
  }

  initializeCronJobs() {
    // Agendar o cron para rodar todo dia às 9h
    cron.schedule("0 9 * * *", async () => {
      await this.checkExpiringPlans();
    });

    cron.schedule("*/15 * * * *", async () => {
      await this.processScheduledCampaigns();
    });
  }
}

export default new EmailService();
