import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const r2Client = new S3Client({
  region: 'auto',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
  endpoint: process.env.R2_ENDPOINT,
})

const bucket = process.env.R2_BUCKET || 'website-builder-agent'

export async function saveFile(
  projectId: string,
  environment: 'preview' | 'production',
  filePath: string,
  content: string,
  contentType: string = 'text/plain'
) {
  const key = `projects/${projectId}/${environment}/${filePath}`

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: content,
    ContentType: contentType,
  })

  await r2Client.send(command)
  return { key, url: `https://${bucket}.r2.cloudflarestorage.com/${key}` }
}

export async function getFile(
  projectId: string,
  environment: 'preview' | 'production',
  filePath: string
) {
  const key = `projects/${projectId}/${environment}/${filePath}`

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  })

  try {
    const response = await r2Client.send(command)
    const content = await response.Body?.transformToString()
    return content
  } catch (error) {
    console.error(`File not found: ${key}`, error)
    return null
  }
}

export async function getFileUrl(
  projectId: string,
  environment: 'preview' | 'production',
  filePath: string
) {
  const key = `projects/${projectId}/${environment}/${filePath}`
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  })

  const url = await getSignedUrl(r2Client, command, { expiresIn: 3600 })
  return url
}
