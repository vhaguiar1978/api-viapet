import { DataTypes } from 'sequelize';
import sequelize from '../database/config.js';

const Subscription = sequelize.define('Subscription', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    allowNull: false
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    },
    comment: 'ID do usuário que assina o plano (apenas users podem assinar, não custumers)'
  },
  plan_type: {
    type: DataTypes.ENUM('monthly', 'promotional', 'trial'),
    allowNull: false,
    defaultValue: 'monthly',
    comment: 'Tipo do plano: monthly (R$ 69,90), promotional (R$ 39,90 nos 3 primeiros meses) ou trial (1 mês grátis)'
  },
  payment_preference_id: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'ID da preferência de pagamento do Mercado Pago'
  },
  payment_id: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'ID do pagamento no Mercado Pago'
  },
  status: {
    type: DataTypes.ENUM('pending', 'active', 'cancelled', 'suspended', 'expired'),
    allowNull: false,
    defaultValue: 'pending',
    comment: 'Status da assinatura'
  },
  payment_status: {
    type: DataTypes.ENUM('pending', 'approved', 'authorized', 'in_process', 'in_mediation', 'rejected', 'cancelled', 'refunded', 'charged_back'),
    allowNull: true,
    comment: 'Status do pagamento no Mercado Pago'
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Valor da mensalidade'
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: 'BRL'
  },
  billing_cycle_start: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Data de início do ciclo de cobrança'
  },
  billing_cycle_end: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Data de fim do ciclo de cobrança'
  },
  next_billing_date: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Data da próxima cobrança'
  },
  trial_start: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Data de início do período gratuito'
  },
  trial_end: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Data de fim do período gratuito'
  },
  promotional_months_used: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Número de meses promocionais já utilizados (máximo 3)'
  },
  payment_method: {
    type: DataTypes.ENUM('credit_card', 'debit_card', 'pix', 'boleto'),
    allowNull: true,
    comment: 'Método de pagamento escolhido'
  },
  webhook_events: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'Histórico de eventos de webhook do Mercado Pago'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Observações sobre a assinatura'
  }
}, {
  tableName: 'subscriptions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['status']
    },
    {
      fields: ['payment_status']
    },
    {
      fields: ['next_billing_date']
    }
  ]
});

export default Subscription;
