require('dotenv').config();
const express = require('express');
const multer = require('multer');
const swaggerUi = require('swagger-ui-express');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, ListBucketsCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Limpar variáveis de ambiente AWS inválidas para forçar uso de IAM Role ou arquivo de credenciais
// Isso garante que não usaremos credenciais expiradas ou inválidas
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_SESSION_TOKEN;
delete process.env.AWS_SECURITY_TOKEN;

// Configuração AWS - usando detecção automática de credenciais
// O AWS SDK detectará automaticamente credenciais através de:
// 1. IAM Role (se estiver rodando em EC2/ECS/Lambda) - PRIORIDADE
// 2. Arquivo de credenciais (~/.aws/credentials)
// 3. Perfil AWS configurado (~/.aws/config)
const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
};

const dynamoClient = new DynamoDBClient(awsConfig);
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client(awsConfig);

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME;
const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Validação de variáveis de ambiente essenciais
if (!TABLE_NAME) {
  console.warn('⚠️  AVISO: DYNAMODB_TABLE_NAME não está definido. Operações do DynamoDB podem falhar.');
}
if (!BUCKET_NAME) {
  console.warn('⚠️  AVISO: S3_BUCKET_NAME não está definido. Operações do S3 podem falhar.');
}

app.use(express.json());

// Swagger Documentation
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'API de Pedidos',
    version: '1.0.0',
    description: 'API para gerenciamento de pedidos com DynamoDB e S3'
  },
  servers: [
    {
      url: `http://localhost:${process.env.PORT || 3000}`,
      description: 'Servidor de desenvolvimento'
    }
  ],
  paths: {
    '/pedidos': {
      post: {
        summary: 'Criar novo pedido',
        tags: ['Pedidos'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['emailCliente', 'nomeCliente', 'valor'],
                properties: {
                  emailCliente: { type: 'string', example: 'cliente@email.com' },
                  nomeCliente: { type: 'string', example: 'João Silva' },
                  valor: { type: 'number', example: 150.50 },
                  status: { type: 'string', enum: ['RECEBIDO', 'PREPARACAO', 'ENVIADO'], example: 'RECEBIDO' },
                  referenciaNota: { type: 'string', example: 'NF-12345' },
                  dataEnvio: { type: 'string', format: 'date-time', example: '2025-01-15T10:30:00Z' }
                }
              }
            }
          }
        },
        responses: {
          201: {
            description: 'Pedido criado com sucesso',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    pedido: { $ref: '#/components/schemas/Pedido' }
                  }
                }
              }
            }
          },
          400: { description: 'Dados inválidos' },
          500: { description: 'Erro no servidor' }
        }
      },
      get: {
        summary: 'Listar todos os pedidos',
        tags: ['Pedidos'],
        responses: {
          200: {
            description: 'Lista de pedidos',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total: { type: 'number' },
                    pedidos: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Pedido' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/pedidos/{id}': {
      get: {
        summary: 'Consultar pedido específico',
        tags: ['Pedidos'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'ID do pedido (GUID)'
          }
        ],
        responses: {
          200: {
            description: 'Pedido encontrado',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Pedido' }
              }
            }
          },
          404: { description: 'Pedido não encontrado' }
        }
      }
    },
    '/pedidos/{idPedido}/upload': {
      post: {
        summary: 'Upload de arquivo vinculado ao pedido',
        tags: ['Upload'],
        parameters: [
          {
            name: 'idPedido',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'ID do pedido (GUID)'
          }
        ],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: {
                    type: 'string',
                    format: 'binary'
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Arquivo enviado com sucesso',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    fileKey: { type: 'string' },
                    idPedido: { type: 'string' },
                    bucket: { type: 'string' }
                  }
                }
              }
            }
          },
          404: { description: 'Pedido não encontrado' }
        }
      }
    },
    '/buckets': {
      get: {
        summary: 'Listar buckets S3',
        tags: ['S3'],
        responses: {
          200: {
            description: 'Lista de buckets',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total: { type: 'number' },
                    buckets: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          creationDate: { type: 'string', format: 'date-time' }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/s3/arquivos': {
      get: {
        summary: 'Listar arquivos no S3',
        tags: ['S3'],
        parameters: [
          {
            name: 'idPedido',
            in: 'query',
            schema: { type: 'string' },
            description: 'ID do pedido para filtrar arquivos'
          }
        ],
        responses: {
          200: {
            description: 'Lista de arquivos',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total: { type: 'number' },
                    bucket: { type: 'string' },
                    arquivos: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          key: { type: 'string' },
                          size: { type: 'number' },
                          lastModified: { type: 'string', format: 'date-time' },
                          fileName: { type: 'string' },
                          idPedido: { type: 'string', nullable: true }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/pedidos/{idPedido}/arquivos': {
      get: {
        summary: 'Listar arquivos de um pedido específico',
        tags: ['Pedidos', 'Upload'],
        parameters: [
          {
            name: 'idPedido',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'ID do pedido (GUID)'
          }
        ],
        responses: {
          200: {
            description: 'Lista de arquivos do pedido',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    idPedido: { type: 'string' },
                    pedido: {
                      type: 'object',
                      properties: {
                        nomeCliente: { type: 'string' },
                        emailCliente: { type: 'string' }
                      }
                    },
                    total: { type: 'number' },
                    arquivos: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          key: { type: 'string' },
                          size: { type: 'number' },
                          lastModified: { type: 'string', format: 'date-time' },
                          fileName: { type: 'string' },
                          url: { type: 'string' }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          404: { description: 'Pedido não encontrado' }
        }
      }
    }
  },
  components: {
    schemas: {
      Pedido: {
        type: 'object',
        properties: {
          idPedido: { type: 'string', format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' },
          emailCliente: { type: 'string', example: 'cliente@email.com' },
          nomeCliente: { type: 'string', example: 'João Silva' },
          valor: { type: 'number', example: 150.50 },
          data: { type: 'string', format: 'date-time', example: '2025-01-15T10:30:00Z' },
          status: { type: 'string', enum: ['RECEBIDO', 'PREPARACAO', 'ENVIADO'], example: 'RECEBIDO' },
          referenciaNota: { type: 'string', nullable: true, example: 'NF-12345' },
          dataEnvio: { type: 'string', format: 'date-time', nullable: true, example: '2025-01-16T14:00:00Z' }
        }
      }
    }
  }
};

// Swagger UI
app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Endpoint de diagnóstico AWS
app.get('/health/aws', async (req, res) => {
  try {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      region: awsConfig.region,
      dynamodbTable: TABLE_NAME || 'NÃO DEFINIDA',
      s3Bucket: BUCKET_NAME || 'NÃO DEFINIDO',
      checks: {}
    };

    // Teste DynamoDB
    try {
      const testCommand = new ScanCommand({
        TableName: TABLE_NAME,
        Limit: 1
      });
      await docClient.send(testCommand);
      diagnostics.checks.dynamodb = { status: 'OK', message: 'Conexão com DynamoDB funcionando' };
    } catch (error) {
      diagnostics.checks.dynamodb = { 
        status: 'ERRO', 
        message: error.message,
        errorType: error.name 
      };
    }

    // Teste S3
    try {
      const testCommand = new ListBucketsCommand({});
      await s3Client.send(testCommand);
      diagnostics.checks.s3 = { status: 'OK', message: 'Conexão com S3 funcionando' };
    } catch (error) {
      diagnostics.checks.s3 = { 
        status: 'ERRO', 
        message: error.message,
        errorType: error.name 
      };
    }

    const allOk = Object.values(diagnostics.checks).every(check => check.status === 'OK');
    res.status(allOk ? 200 : 503).json(diagnostics);
  } catch (error) {
    res.status(500).json({ 
      error: 'Erro ao verificar saúde AWS', 
      details: error.message 
    });
  }
});

// POST - Criar novo pedido
app.post('/pedidos', async (req, res) => {
  try {
    const {
      emailCliente,
      nomeCliente,
      valor,
      status = 'RECEBIDO',
      referenciaNota,
      dataEnvio
    } = req.body;

    if (!emailCliente || !nomeCliente || !valor) {
      return res.status(400).json({ 
        error: 'emailCliente, nomeCliente e valor são obrigatórios' 
      });
    }

    const pedido = {
      idPedido: randomUUID(),
      emailCliente,
      nomeCliente,
      valor: parseFloat(valor),
      data: new Date().toISOString(),
      status,
      referenciaNota: referenciaNota || null,
      dataEnvio: dataEnvio || null
    };

    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: pedido
    });

    await docClient.send(command);

    res.status(201).json({
      message: 'Pedido criado com sucesso',
      pedido
    });
  } catch (error) {
    console.error('Erro ao criar pedido:', error);
    
    // Mensagem mais específica para erros de credenciais AWS
    let errorMessage = error.message;
    if (error.name === 'UnrecognizedClientException' || error.message.includes('security token')) {
      errorMessage = 'Erro de autenticação AWS: As credenciais detectadas automaticamente estão inválidas ou expiradas. ' +
        'Verifique se: (1) A instância EC2 tem uma IAM Role válida com permissões para DynamoDB e S3, ' +
        'ou (2) As credenciais em ~/.aws/credentials estão corretas e não expiradas. ' +
        'Variáveis de ambiente AWS_* foram ignoradas para evitar uso de credenciais inválidas.';
    }
    
    res.status(500).json({ 
      error: 'Erro ao criar pedido', 
      details: errorMessage 
    });
  }
});

// POST - Upload de arquivo no S3 vinculado a um pedido (na raiz do bucket)
app.post('/pedidos/:idPedido/upload', upload.single('file'), async (req, res) => {
  try {
    const { idPedido } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    // Verifica se o pedido existe
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { idPedido: idPedido }
    });

    const { Item } = await docClient.send(getCommand);

    if (!Item) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    // Upload do arquivo no S3 na raiz do bucket
    // Formato: timestamp-nome_original.ext
    const fileKey = `${Date.now()}-${req.file.originalname}`;
    
    const s3Command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      Metadata: {
        idPedido: idPedido,
        dataUpload: new Date().toISOString()
      }
    });

    await s3Client.send(s3Command);

    res.status(200).json({
      message: 'Arquivo enviado com sucesso',
      fileKey,
      idPedido,
      bucket: BUCKET_NAME
    });
  } catch (error) {
    console.error('Erro ao fazer upload:', error);
    res.status(500).json({ error: 'Erro ao fazer upload', details: error.message });
  }
});

// GET - Listar todos os pedidos
app.get('/pedidos', async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: TABLE_NAME
    });

    const { Items } = await docClient.send(command);

    res.status(200).json({
      total: Items.length,
      pedidos: Items
    });
  } catch (error) {
    console.error('Erro ao listar pedidos:', error);
    res.status(500).json({ error: 'Erro ao listar pedidos', details: error.message });
  }
});

// GET - Consultar pedido específico
app.get('/pedidos/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: { idPedido: id }
    });

    const { Item } = await docClient.send(command);

    if (!Item) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    res.status(200).json(Item);
  } catch (error) {
    console.error('Erro ao consultar pedido:', error);
    res.status(500).json({ error: 'Erro ao consultar pedido', details: error.message });
  }
});

// GET - Listar buckets S3
app.get('/buckets', async (req, res) => {
  try {
    const command = new ListBucketsCommand({});
    const { Buckets } = await s3Client.send(command);

    res.status(200).json({
      total: Buckets.length,
      buckets: Buckets.map(bucket => ({
        name: bucket.Name,
        creationDate: bucket.CreationDate
      }))
    });
  } catch (error) {
    console.error('Erro ao listar buckets:', error);
    res.status(500).json({ error: 'Erro ao listar buckets', details: error.message });
  }
});

// GET - Listar arquivos no S3
app.get('/s3/arquivos', async (req, res) => {
  try {
    const { idPedido } = req.query;
    
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME
    });

    const response = await s3Client.send(command);

    let arquivos = (response.Contents || []).map(item => {
      // Extrai o idPedido dos metadados (quando disponível via HeadObject)
      // Por enquanto, retorna null já que ListObjectsV2 não retorna metadados
      return {
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified,
        fileName: item.Key,
        idPedido: null // Metadados não disponíveis no ListObjectsV2
      };
    });

    // Se idPedido for fornecido, precisaríamos fazer HeadObject para cada arquivo
    // para verificar os metadados. Por simplicidade, retornamos todos os arquivos
    if (idPedido) {
      // Nota: Para filtrar por idPedido, seria necessário fazer HeadObject em cada arquivo
      // o que pode ser custoso. Considere usar tags ou naming convention alternativa.
      console.log(`Filtro por idPedido ${idPedido} requer verificação de metadados`);
    }

    res.status(200).json({
      total: arquivos.length,
      bucket: BUCKET_NAME,
      arquivos
    });
  } catch (error) {
    console.error('Erro ao listar arquivos:', error);
    res.status(500).json({ error: 'Erro ao listar arquivos', details: error.message });
  }
});

// GET - Listar arquivos de um pedido específico
app.get('/pedidos/:idPedido/arquivos', async (req, res) => {
  try {
    const { idPedido } = req.params;
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');

    // Verifica se o pedido existe
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { idPedido: idPedido }
    });

    const { Item } = await docClient.send(getCommand);

    if (!Item) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    // Lista todos os arquivos do bucket
    const s3Command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME
    });

    const response = await s3Client.send(s3Command);

    // Filtra arquivos que pertencem a este pedido verificando metadados
    const arquivosPromises = (response.Contents || []).map(async (item) => {
      try {
        const headCommand = new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: item.Key
        });
        
        const headResponse = await s3Client.send(headCommand);
        
        // Verifica se o arquivo pertence ao pedido
        if (headResponse.Metadata && headResponse.Metadata.idpedido === idPedido) {
          return {
            key: item.Key,
            size: item.Size,
            lastModified: item.LastModified,
            fileName: item.Key,
            url: `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${item.Key}`
          };
        }
        return null;
      } catch (error) {
        console.error(`Erro ao obter metadados de ${item.Key}:`, error);
        return null;
      }
    });

    const arquivosResolvidos = await Promise.all(arquivosPromises);
    const arquivos = arquivosResolvidos.filter(arquivo => arquivo !== null);

    res.status(200).json({
      idPedido,
      pedido: {
        nomeCliente: Item.nomeCliente,
        emailCliente: Item.emailCliente
      },
      total: arquivos.length,
      arquivos
    });
  } catch (error) {
    console.error('Erro ao listar arquivos do pedido:', error);
    res.status(500).json({ error: 'Erro ao listar arquivos', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Documentação Swagger disponível em http://localhost:${PORT}/swagger`);
  console.log(`\n📋 Configuração AWS:`);
  console.log(`   Região: ${awsConfig.region}`);
  console.log(`   Tabela DynamoDB: ${TABLE_NAME || 'NÃO DEFINIDA'}`);
  console.log(`   Bucket S3: ${BUCKET_NAME || 'NÃO DEFINIDO'}`);
  console.log(`   Método de autenticação: Detecção automática (IAM Role / ~/.aws/credentials)`);
  console.log(`\n⚠️  Certifique-se de que:`);
  console.log(`   1. A instância EC2 tem uma IAM Role com permissões para DynamoDB e S3`);
  console.log(`   2. Ou configure credenciais válidas em ~/.aws/credentials`);
  console.log(`\n`);
});

module.exports = app;