"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const userColumns = await queryInterface.describeTable("users");
    const columns = {
      registrationStatus: { type: Sequelize.STRING(48), allowNull: false, defaultValue: "cadastro_ativo" },
      emailConfirmedAt: { type: Sequelize.DATE, allowNull: true },
      phoneConfirmedAt: { type: Sequelize.DATE, allowNull: true },
      companyName: { type: Sequelize.STRING, allowNull: true },
      trustedAt: { type: Sequelize.DATE, allowNull: true },
    };
    for (const [name, definition] of Object.entries(columns)) {
      if (!userColumns[name]) await queryInterface.addColumn("users", name, definition);
    }
    // Cadastros legados podem compartilhar telefone. A unicidade passa a valer
    // quando o proprietario e confirmado, sem apagar ou alterar dados existentes.
    await queryInterface.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_owner_phone_unique ON users (phone) WHERE role = 'proprietario' AND "trustedAt" IS NOT NULL`);
    const existingTables = new Set((await queryInterface.showAllTables()).map((table) => String(table).toLowerCase()));
    if (!existingTables.has("registration_verifications")) await queryInterface.createTable("registration_verifications", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      channel: { type: Sequelize.ENUM("email", "phone"), allowNull: false }, codeHash: { type: Sequelize.STRING(128), allowNull: false },
      expiresAt: { type: Sequelize.DATE, allowNull: false }, consumedAt: { type: Sequelize.DATE }, attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      sentAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") }, createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    const verificationIndexes = await queryInterface.showIndex("registration_verifications");
    if (!verificationIndexes.some((index) => index.name === "registration_verifications_user_id_channel_created_at")) await queryInterface.addIndex("registration_verifications", ["userId", "channel", "createdAt"], { name: "registration_verifications_user_id_channel_created_at" });
    if (!existingTables.has("registration_security_events")) await queryInterface.createTable("registration_security_events", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true }, userId: { type: Sequelize.UUID, allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL" },
      eventType: { type: Sequelize.STRING(64), allowNull: false }, ip: Sequelize.STRING(64), country: Sequelize.STRING(80), city: Sequelize.STRING(120), browser: Sequelize.STRING(120), os: Sequelize.STRING(120), device: Sequelize.STRING(120), deviceFingerprint: Sequelize.STRING(128), email: Sequelize.STRING, phone: Sequelize.STRING(32),
      success: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true }, metadata: { type: Sequelize.JSON, allowNull: false, defaultValue: {} }, createdAt: { type: Sequelize.DATE, allowNull: false },
    });
    const securityIndexes = await queryInterface.showIndex("registration_security_events");
    if (!securityIndexes.some((index) => index.name === "registration_security_events_ip_created_at")) await queryInterface.addIndex("registration_security_events", ["ip", "createdAt"], { name: "registration_security_events_ip_created_at" });
    if (!securityIndexes.some((index) => index.name === "registration_security_events_device_created_at")) await queryInterface.addIndex("registration_security_events", ["deviceFingerprint", "createdAt"], { name: "registration_security_events_device_created_at" });
    if (!existingTables.has("registration_ip_blocks")) await queryInterface.createTable("registration_ip_blocks", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true }, ip: { type: Sequelize.STRING(64), allowNull: false, unique: true }, reason: Sequelize.TEXT, blockedBy: Sequelize.UUID,
      createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("registration_ip_blocks"); await queryInterface.dropTable("registration_security_events"); await queryInterface.dropTable("registration_verifications");
    await queryInterface.removeIndex("users", "users_owner_phone_unique");
    for (const column of ["trustedAt", "companyName", "phoneConfirmedAt", "emailConfirmedAt", "registrationStatus"]) await queryInterface.removeColumn("users", column);
  },
};
