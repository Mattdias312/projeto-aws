// Lambda: lambda-preparacao
// Trigger: API Gateway (POST)
// Função: Atualizar status do pedido para PREPARACAO

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'pedidos';

exports.handler = async (event) => {
  console.log('Evento recebido:', JSON.stringify(event, null, 2));

  try {
    // Extrair idPedido do body da requisição
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (e) {
      body = event.body;
    }

    const { idPedido } = body;

    if (!idPedido) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'idPedido é obrigatório'
        })
      };
    }

    // Verificar se o pedido existe
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { idPedido }
    });

    const { Item } = await docClient.send(getCommand);

    if (!Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'Pedido não encontrado'
        })
      };
    }

    // Atualizar status para PREPARACAO
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { idPedido },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'PREPARACAO'
      },
      ReturnValues: 'ALL_NEW'
    });

    const result = await docClient.send(updateCommand);

    console.log('Pedido atualizado para PREPARACAO:', result.Attributes);

    // O DynamoDB Stream irá automaticamente invocar a lambda-notificacao
    // quando o status for atualizado

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Pedido atualizado para PREPARACAO',
        pedido: result.Attributes
      })
    };
  } catch (error) {
    console.error('Erro ao processar:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Erro ao processar pedido',
        details: error.message
      })
    };
  }
};

