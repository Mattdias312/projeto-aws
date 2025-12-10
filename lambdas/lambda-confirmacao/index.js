// Lambda: lambda-confirmacao
// Trigger: S3 Event (quando PDF é enviado)
// Função: Atualizar pedido com status ENVIADO, dataEnvio e referenciaNota

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'pedidos';

exports.handler = async (event) => {
  console.log('Evento recebido:', JSON.stringify(event, null, 2));

  try {
    // Processar cada registro do S3
    for (const record of event.Records) {
      const bucket = record.s3.bucket.name;
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

      console.log(`Processando arquivo: ${bucket}/${key}`);

      // Verificar se é um arquivo PDF
      if (!key.toLowerCase().endsWith('.pdf')) {
        console.log(`Arquivo ${key} não é um PDF. Ignorando.`);
        continue;
      }

      // Obter metadados do objeto S3 para pegar o idPedido
      const headCommand = new HeadObjectCommand({
        Bucket: bucket,
        Key: key
      });

      const headResponse = await s3Client.send(headCommand);
      const idPedido = headResponse.Metadata?.idpedido || headResponse.Metadata?.idPedido;

      if (!idPedido) {
        console.log(`Arquivo ${key} não possui idPedido nos metadados. Ignorando.`);
        continue;
      }

      console.log(`Atualizando pedido ${idPedido} com arquivo ${key}`);

      // Extrair nome do arquivo (sem path)
      const nomeArquivo = key.split('/').pop();

      // Atualizar pedido no DynamoDB
      const updateCommand = new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { idPedido },
        UpdateExpression: 'SET #status = :status, dataEnvio = :dataEnvio, referenciaNota = :referenciaNota',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'ENVIADO',
          ':dataEnvio': new Date().toISOString(),
          ':referenciaNota': nomeArquivo
        },
        ReturnValues: 'ALL_NEW'
      });

      const result = await docClient.send(updateCommand);

      console.log('Pedido atualizado:', result.Attributes);

      // O DynamoDB Stream irá automaticamente invocar a lambda-notificacao
      // quando o status for atualizado
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Pedidos processados com sucesso' })
    };
  } catch (error) {
    console.error('Erro ao processar:', error);
    throw error;
  }
};

