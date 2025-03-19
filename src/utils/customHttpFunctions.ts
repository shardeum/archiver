import axios, { AxiosInstance, AxiosProgressEvent, AxiosRequestConfig, CancelTokenSource } from 'axios'
import { config } from '../Config'
import fetch, { RequestInfo, RequestInit, Response } from 'node-fetch'
import { Utils } from '@shardeum-foundation/lib-types'
import { PassThrough } from 'stream'

/**
 * A custom fetch function with a max response body size limit.
 * @param input URL or Request object.
 * @param init Optional fetch configuration.
 * @param maxBytes Maximum response size in bytes (default: config.maxResponseSize).
 * @returns A Response.
 */
export async function customFetch(
  input: RequestInfo,
  init?: RequestInit,
  maxBytes?: number
): Promise<Response> {
  const downloadLimit = maxBytes ?? config.maxResponseSize
  return await fetch(input, { ...init, size: downloadLimit })
}

/**
 * Creates a custom axios instance with size limiting
 * @param maxBytes Maximum response size in bytes (default: 10MB)
 * @param axiosConfig Additional axios axiosConfig options
 * @returns Custom axios instance
 */
export function customAxios(maxBytes?: number, axiosConfig: AxiosRequestConfig = {}): AxiosInstance {
  const downloadLimit = maxBytes ?? config.maxResponseSize
  const userRequestedType = axiosConfig.responseType ?? 'json'
  axiosConfig.responseType = 'stream'
  const instance = axios.create({
    ...axiosConfig,
    validateStatus: () => true,
  })

  instance.interceptors.request.use((request) => {
    const source = axios.CancelToken.source()
    request.cancelToken = source.token
    ;(request as any)._cancelSource = source
    return request
  })

  instance.interceptors.response.use(
    async (response) => {
      const contentLength = parseInt(response.headers['content-length'] || '0', 10)
      if (contentLength > 0 && contentLength > downloadLimit) {
        ;(response.config as any)._cancelSource?.cancel(
          `Response content-length ${contentLength} exceeds limit of ${downloadLimit}`
        )
        throw new Error(`Response size exceeds limit of ${downloadLimit} bytes`)
      }

      const stream = response.data
      let totalBytes = 0
      const chunks: Buffer[] = []

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length
          if (totalBytes > downloadLimit) {
            stream.destroy(
              new Error(`Response size exceeds limit of ${downloadLimit} bytes`)
            )
            return
          }
          chunks.push(chunk)
        })

        stream.on('end', () => {
          const fullBuffer = Buffer.concat(chunks)

          switch (userRequestedType) {
            case 'stream': { // If user truly wants a stream, we can either:
              const pass = new PassThrough()
              pass.end(fullBuffer)
              response.data = pass
              break
            }

            case 'arraybuffer':
              response.data = fullBuffer
              break

            case 'json':
            default:
              try {
                response.data = Utils.safeJsonParse(fullBuffer.toString('utf8'))
              } catch (err: any) {
                return reject(
                  new Error(`Failed to parse JSON (size: ${fullBuffer.length} bytes): ${err.message}`)
                )
              }
              break
          }

          resolve(response)
        })

        stream.on('error', (err: Error) => {
          reject(err)
        })
      })
    },
    (error) => {
      // Distinguish cancellation due to size from other errors
      if (axios.isCancel(error)) {
        throw new Error(`Response size exceeds limit of ${downloadLimit} bytes`)
      }
      throw error
    }
  )

  return instance
}
