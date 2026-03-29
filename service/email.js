import nodemailer from "nodemailer";
import Admin from "../models/Admin.js";
import cron from "node-cron";
import { Op } from "sequelize";
import Users from "../models/Users.js";

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeCronJobs();
  }

  async initializeTransporter() {
    try {
      const settings = await Admin.findOne();

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
      if (!this.transporter) {
        await this.initializeTransporter();
      }

      const settings = await Admin.findOne();

      const resetLink = `${process.env.FRONTEND_URL}/redefinir-senha?token=${token}`;

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
              <a href="${resetLink}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">
                Redefinir Senha
              </a>
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
                <a href="#" style="background-color: #4CAF50; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">APROVEITAR AGORA</a>
              </div>

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

  initializeCronJobs() {
    // Agendar o cron para rodar todo dia às 9h
    cron.schedule("0 9 * * *", async () => {
      await this.checkExpiringPlans();
    });
  }
}

export default new EmailService();
