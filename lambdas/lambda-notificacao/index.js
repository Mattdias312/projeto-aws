// Lambda: lambda-notificacao
// Trigger: DynamoDB Stream (chamada quando status é atualizado)
// Função: Enviar email de notificação baseado no status do pedido
// NOTA: Esta lambda é similar à lambda-execucao, mas pode ser chamada por outras lambdas também

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const sesClient = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Templates de email por status
const emailTemplates = {
  RECEBIMENTO: {
    subject: 'Pedido Recebido - Confirmação',
    body: (pedido) => `
      <h2>Pedido Recebido com Sucesso!</h2>
      <p>Olá ${pedido.nomeCliente},</p>
      <p>Seu pedido foi recebido e está sendo processado.</p>
      <p><strong>Detalhes do Pedido:</strong></p>
      <ul>
        <li><strong>ID do Pedido:</strong> ${pedido.idPedido}</li>
        <li><strong>Valor:</strong> R$ ${pedido.valor.toFixed(2)}</li>
        <li><strong>Status:</strong> ${pedido.status}</li>
        <li><strong>Data:</strong> ${new Date(pedido.data).toLocaleString('pt-BR')}</li>
      </ul>
      <p>Você receberá atualizações sobre o status do seu pedido em breve.</p>
      <p>Atenciosamente,<br>Equipe de E-commerce</p>
    `
  },
  PREPARACAO: {
    subject: 'Pedido em Preparação',
    body: (pedido) => `
      <h2>Seu Pedido Está Sendo Preparado!</h2>
      <p>Olá ${pedido.nomeCliente},</p>
      <p>Seu pedido está sendo preparado para envio.</p>
      <p><strong>Detalhes do Pedido:</strong></p>
      <ul>
        <li><strong>ID do Pedido:</strong> ${pedido.idPedido}</li>
        <li><strong>Valor:</strong> R$ ${pedido.valor.toFixed(2)}</li>
        <li><strong>Status:</strong> ${pedido.status}</li>
      </ul>
      <p>Em breve você receberá informações sobre o envio.</p>
      <p>Atenciosamente,<br>Equipe de E-commerce</p>
    `
  },
  ENVIADO: {
    subject: 'Pedido Enviado',
    body: (pedido) => `
      <h2>Seu Pedido Foi Enviado!</h2>
      <p>Olá ${pedido.nomeCliente},</p>
      <p>Seu pedido foi enviado com sucesso!</p>
      <p><strong>Detalhes do Pedido:</strong></p>
      <ul>
        <li><strong>ID do Pedido:</strong> ${pedido.idPedido}</li>
        <li><strong>Valor:</strong> R$ ${pedido.valor.toFixed(2)}</li>
        <li><strong>Status:</strong> ${pedido.status}</li>
        <li><strong>Data de Envio:</strong> ${pedido.dataEnvio ? new Date(pedido.dataEnvio).toLocaleString('pt-BR') : 'N/A'}</li>
        <li><strong>Referência da Nota:</strong> ${pedido.referenciaNota || 'N/A'}</li>
      </ul>
      <p>Obrigado por sua compra!</p>
      <p>Atenciosamente,<br>Equipe de E-commerce</p>
    `
  }
};

exports.handler = async (event) => {
  console.log('Evento recebido:', JSON.stringify(event, null, 2));

  try {
    // Processar cada registro do DynamoDB Stream
    for (const record of event.Records) {
      // Processar apenas MODIFY (atualizações), não INSERT (criações iniciais)
      if (record.eventName === 'MODIFY') {
        const newImage = record.dynamodb.NewImage;
        const oldImage = record.dynamodb.OldImage;
        
        // Verificar se o status mudou
        const oldStatus = oldImage?.status?.S;
        const newStatus = newImage?.status?.S;

        if (oldStatus === newStatus) {
          console.log('Status não mudou. Ignorando.');
          continue;
        }

        // Converter imagem do DynamoDB para objeto JavaScript
        const pedido = {
          idPedido: newImage.idPedido?.S,
          emailCliente: newImage.emailCliente?.S,
          nomeCliente: newImage.nomeCliente?.S,
          valor: parseFloat(newImage.valor?.N || 0),
          data: newImage.data?.S,
          status: newStatus,
          referenciaNota: newImage.referenciaNota?.S || null,
          dataEnvio: newImage.dataEnvio?.S || null
        };

        console.log('Processando notificação para pedido:', pedido);

        // Verificar se há template para o status
        const template = emailTemplates[pedido.status];
        if (!template) {
          console.log(`Status ${pedido.status} não possui template de email. Ignorando.`);
          continue;
        }

        // Verificar se o email é válido
        if (!pedido.emailCliente) {
          console.log('Email do cliente não encontrado. Ignorando.');
          continue;
        }

        // Enviar email usando SES
        const emailParams = {
          Source: process.env.SES_FROM_EMAIL || 'noreply@example.com',
          Destination: {
            ToAddresses: [pedido.emailCliente]
          },
          Message: {
            Subject: {
              Data: template.subject,
              Charset: 'UTF-8'
            },
            Body: {
              Html: {
                Data: template.body(pedido),
                Charset: 'UTF-8'
              }
            }
          }
        };

        const command = new SendEmailCommand(emailParams);
        const result = await sesClient.send(command);

        console.log('Email enviado com sucesso:', result.MessageId);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Notificações processadas com sucesso' })
    };
  } catch (error) {
    console.error('Erro ao processar evento:', error);
    throw error;
  }
};

