#!/usr/bin/env node

/**
 * Script para verificar e processar assinaturas vencidas
 * Deve ser executado periodicamente via cron job ou similar
 * 
 * Uso: node scripts/check-subscriptions.js
 */

import dotenv from 'dotenv';
import { Op } from 'sequelize';
import Subscription from '../models/Subscription.js';
import PaymentHistory from '../models/PaymentHistory.js';
import Users from '../models/Users.js';
import { checkExpiredSubscriptions, planPrices } from '../service/mercadopago.js';
import { setupAssociations } from '../models/associations.js';

// Configurar environment
dotenv.config();

// Configurar associações
setupAssociations();

/**
 * Função principal para verificar assinaturas
 */
async function checkSubscriptions() {
  console.log(`🔍 Iniciando verificação de assinaturas - ${new Date().toISOString()}`);
  
  try {
    const now = new Date();
    
    // 1. Verificar assinaturas que estão próximas do vencimento (5 dias antes)
    const upcomingExpiry = new Date(now.getTime() + (5 * 24 * 60 * 60 * 1000));
    
    const upcomingSubscriptions = await Subscription.findAll({
      where: {
        status: 'active',
        next_billing_date: {
          [Op.between]: [now, upcomingExpiry]
        }
      },
      include: [
        {
          model: Users,
          as: 'user',
          attributes: ['id', 'name', 'email']
        }
      ]
    });

    console.log(`📅 Encontradas ${upcomingSubscriptions.length} assinaturas próximas do vencimento`);

    // 2. Verificar assinaturas vencidas
    const expiredSubscriptions = await Subscription.findAll({
      where: {
        status: 'active',
        next_billing_date: {
          [Op.lt]: now
        }
      },
      include: [
        {
          model: Users,
          as: 'user',
          attributes: ['id', 'name', 'email']
        }
      ]
    });

    console.log(`⏰ Encontradas ${expiredSubscriptions.length} assinaturas vencidas`);

    // 3. Processar assinaturas vencidas
    for (const subscription of expiredSubscriptions) {
      try {
        await processExpiredSubscription(subscription);
      } catch (error) {
        console.error(`❌ Não foi possível processar a assinatura ${subscription.id}:`, error.message);
      }
    }

    // 4. Verificar assinaturas em período trial que estão vencendo
    const trialExpiring = await Subscription.findAll({
      where: {
        status: 'active',
        trial_end: {
          [Op.not]: null,
          [Op.between]: [now, upcomingExpiry]
        }
      },
      include: [
        {
          model: Users,
          as: 'user',
          attributes: ['id', 'name', 'email']
        }
      ]
    });

    console.log(`🆓 Encontradas ${trialExpiring.length} assinaturas trial próximas do vencimento`);

    // 5. Processar assinaturas trial vencidas
    const trialExpired = await Subscription.findAll({
      where: {
        status: 'active',
        trial_end: {
          [Op.not]: null,
          [Op.lt]: now
        }
      }
    });

    for (const subscription of trialExpired) {
      try {
        await processExpiredTrial(subscription);
      } catch (error) {
        console.error(`❌ Erro ao processar trial vencida ${subscription.id}:`, error.message);
      }
    }

    console.log(`✅ Verificação concluída - ${new Date().toISOString()}`);
    
    return {
      success: true,
      upcoming: upcomingSubscriptions.length,
      expired: expiredSubscriptions.length,
      trialExpiring: trialExpiring.length,
      trialExpired: trialExpired.length
    };

  } catch (error) {
    console.error('💥 Erro na verificação de assinaturas:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Processar assinatura vencida
 */
async function processExpiredSubscription(subscription) {
  const daysOverdue = Math.floor((new Date() - new Date(subscription.next_billing_date)) / (1000 * 60 * 60 * 24));
  
  console.log(`🚨 Processando assinatura vencida ${subscription.id} - ${daysOverdue} dias em atraso`);

  if (daysOverdue <= 7) {
    // Período de graça: manter ativa mas enviar notificação
    await subscription.update({
      status: 'active', // Manter ativa
      notes: `Assinatura com ${daysOverdue} dias de atraso - período de graça`
    });
    
    console.log(`⚠️ Assinatura ${subscription.id} em período de graça (${daysOverdue} dias)`);
    
    // Aqui você pode adicionar lógica para enviar email de lembrete
    // await sendPaymentReminderEmail(subscription.user);
    
  } else if (daysOverdue <= 30) {
    // Suspender assinatura após 7 dias
    await subscription.update({
      status: 'suspended',
      notes: `Assinatura suspensa por falta de pagamento - ${daysOverdue} dias em atraso`
    });
    
    console.log(`⏸️ Assinatura ${subscription.id} suspensa (${daysOverdue} dias em atraso)`);
    
    // Aqui você pode adicionar lógica para enviar email de suspensão
    // await sendSuspensionEmail(subscription.user);
    
  } else {
    // Cancelar assinatura após 30 dias
    await subscription.update({
      status: 'cancelled',
      notes: `Assinatura cancelada automaticamente por falta de pagamento - ${daysOverdue} dias em atraso`
    });
    
    console.log(`❌ Assinatura ${subscription.id} cancelada automaticamente (${daysOverdue} dias em atraso)`);
    
    // Aqui você pode adicionar lógica para enviar email de cancelamento
    // await sendCancellationEmail(subscription.user);
  }
}

/**
 * Processar trial vencida
 */
async function processExpiredTrial(subscription) {
  console.log(`🆓➡️💳 Trial vencida para assinatura ${subscription.id} - convertendo para cobrança`);
  
  const nextBilling = new Date();
  nextBilling.setDate(nextBilling.getDate() + 30); // Próxima cobrança em 30 dias
  
  await subscription.update({
    status: 'pending', // Aguardando primeiro pagamento
    trial_start: null,
    trial_end: null,
    billing_cycle_start: new Date(),
    billing_cycle_end: nextBilling,
    next_billing_date: new Date(), // Cobrança imediata
    notes: 'Trial vencida - convertida para cobrança'
  });
  
  // Aqui você pode adicionar lógica para:
  // 1. Criar preferência de pagamento no Mercado Pago
  // 2. Enviar email solicitando pagamento
  // 3. Mostrar modal de pagamento no app
  
  console.log(`✅ Trial convertida para cobrança - próxima data: ${nextBilling.toISOString()}`);
}

/**
 * Executar o script
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  checkSubscriptions()
    .then(result => {
      console.log('📊 Resultado final:', result);
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Erro fatal:', error);
      process.exit(1);
    });
}

export default checkSubscriptions;
