// Lambda: lambda-envio
// Trigger: EventBridge Schedule (a cada 5 minutos)
// Função: Buscar pedidos com status RECEBIMENTO há mais de 4 minutos e enviar para API

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const https = require('https');

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'pedidos';
const API_URL = process.env.API_PREPARACAO_URL || 'https://seu-api-gateway.execute-api.us-east-1.amazonaws.com/preparacao';

exports.handler = async (event) => {
  console.log('Evento recebido:', JSON.stringify(event, null, 2));

  try {
    // Buscar todos os pedidos com status RECEBIMENTO
    const scanCommand = new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'RECEBIMENTO'
      }
    });

    const result = await docClient.send(scanCommand);
    const pedidos = result.Items || [];

    console.log(`Encontrados ${pedidos.length} pedidos com status RECEBIMENTO`);

    // Filtrar pedidos com mais de 4 minutos
    const agora = new Date();
    const pedidosPendentes = pedidos.filter(pedido => {
      const dataPedido = new Date(pedido.data);
      const diferencaMinutos = (agora - dataPedido) / (1000 * 60);
      return diferencaMinutos > 4;
    });

    console.log(`Encontrados ${pedidosPendentes.length} pedidos pendentes (> 4 minutos)`);

    // Enviar requisição POST para API para cada pedido pendente
    const resultados = [];
    for (const pedido of pedidosPendentes) {
      try {
        const resultado = await enviarParaAPI(pedido.idPedido);
        resultados.push({
          idPedido: pedido.idPedido,
          sucesso: true,
          resultado
        });
        console.log(`Pedido ${pedido.idPedido} enviado com sucesso para API`);
      } catch (error) {
        console.error(`Erro ao enviar pedido ${pedido.idPedido}:`, error);
        resultados.push({
          idPedido: pedido.idPedido,
          sucesso: false,
          erro: error.message
        });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Processamento concluído',
        totalPedidos: pedidos.length,
        pedidosPendentes: pedidosPendentes.length,
        resultados
      })
    };
  } catch (error) {
    console.error('Erro ao processar:', error);
    throw error;
  }
};

// Função auxiliar para enviar requisição HTTP POST
function enviarParaAPI(idPedido) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_URL);
    const data = JSON.stringify({ idPedido });

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({
            statusCode: res.statusCode,
            body: responseData
          });
        } else {
          reject(new Error(`API retornou status ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

