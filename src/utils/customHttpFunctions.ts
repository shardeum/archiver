import axios, { AxiosInstance, AxiosProgressEvent, AxiosRequestConfig, CancelTokenSource } from 'axios'
import { config } from '../Config'
import fetch, { RequestInfo, RequestInit, Response } from 'node-fetch'

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
  // Use the provided maxBytes or fall back to config.maxResponseSize
  const downloadLimit = maxBytes ?? config.maxResponseSize

  const instance = axios.create({
    ...axiosConfig,
    maxContentLength: downloadLimit,
    maxBodyLength: downloadLimit,
    // Add responseType for better handling
    responseType: 'arraybuffer',
    // Don't automatically reject on error status codes
    validateStatus: () => true,
  })

  // Add request interceptor to add a cancel token
  instance.interceptors.request.use((request) => {
    const source = axios.CancelToken.source()
    request.cancelToken = source.token
    ;(request as any)._cancelSource = source
    return request
  })

  // Add response interceptor to check size
  instance.interceptors.response.use(
    (response) => {
      // Check size for different response types
      if (response.data) {
        let dataSize = 0

        if (response.data instanceof ArrayBuffer) {
          dataSize = response.data.byteLength
        } else if (typeof response.data === 'string') {
          dataSize = response.data.length
        } else if (Buffer.isBuffer(response.data)) {
          dataSize = response.data.length
        } else if (typeof response.data === 'object') {
          // For JSON responses
          dataSize = JSON.stringify(response.data).length
        }

        if (dataSize > downloadLimit) {
          throw new Error(`Response size of ${dataSize} bytes exceeds limit of ${downloadLimit} bytes`)
        }
      }

      // Also check Content-Length header if available
      const contentLength = parseInt(response.headers['content-length'] || '0', 10)
      if (contentLength > 0 && contentLength > downloadLimit) {
        throw new Error(
          `Response content length ${contentLength} bytes exceeds limit of ${downloadLimit} bytes`
        )
      }

      return response
    },
    (error) => {
      if (axios.isCancel(error)) {
        throw new Error(`Response size exceeds limit of ${downloadLimit} bytes`)
      }

      if (
        error.message &&
        (error.message.includes('maxContentLength') ||
          error.message.includes('maxBodyLength') ||
          error.message.includes('socket hang up'))
      ) {
        throw new Error(`Response size exceeds limit of ${downloadLimit} bytes`)
      }

      throw error
    }
  )

  // Handle download progress
  instance.defaults.onDownloadProgress = (progressEvent: AxiosProgressEvent) => {
    if (progressEvent.loaded > downloadLimit) {
      try {
        try {
          const event = progressEvent as unknown as { config?: { _cancelSource?: CancelTokenSource } }
          if (event.config?._cancelSource?.cancel) {
            event.config._cancelSource.cancel(`Response size exceeds limit of ${downloadLimit} bytes`)
          }
        } catch (err) {
          // Silently handle any errors with the cancellation
          console.error('Error during request cancellation:', err)
        }
      } catch (err) {
        // Silently handle any errors with the cancellation
        console.error('Error during request cancellation:', err)
      }
    }
  }

  return instance
}
