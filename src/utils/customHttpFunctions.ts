import axios, {AxiosInstance, AxiosRequestConfig} from 'axios';
import {config} from "../Config";
import fetch, {RequestInfo, RequestInit, Response} from 'node-fetch'

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

    // Pass the size option to node-fetch; if the response body exceeds this, an error is thrown.
    return await fetch(input, {...init, size: downloadLimit})
}

/**
 * Creates a custom axios instance with size limiting
 * @param maxBytes Maximum response size in bytes (default: 10MB)
 * @param config Additional axios config options
 * @returns Custom axios instance
 */
export function customAxios(maxBytes = 10 * 1024 * 1024, config: AxiosRequestConfig = {}): AxiosInstance {
    return axios.create({
        ...config,
        maxContentLength: maxBytes,  // Limits the response size
        maxBodyLength: maxBytes      // Limits the request body size
    });
}
