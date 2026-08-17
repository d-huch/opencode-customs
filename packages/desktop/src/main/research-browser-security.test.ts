import { describe, expect, test } from "bun:test"
import { blockedResearchHostname, privateResearchAddress, safeResearchProtocol } from "./research-browser-security"

describe("Research Browser URL boundary", () => {
  test("allows only HTTP and HTTPS", () => {
    expect(safeResearchProtocol("https://example.com")).toBe(true)
    expect(safeResearchProtocol("http://example.com")).toBe(true)
    expect(safeResearchProtocol("file:///etc/passwd")).toBe(false)
    expect(safeResearchProtocol("data:text/plain,secret")).toBe(false)
    expect(safeResearchProtocol("javascript:alert(1)")).toBe(false)
  })

  test("blocks local hostnames and private or link-local IPs", () => {
    expect(blockedResearchHostname("localhost")).toBe(true)
    expect(blockedResearchHostname("service.local")).toBe(true)
    expect(privateResearchAddress("127.0.0.1")).toBe(true)
    expect(privateResearchAddress("10.0.0.1")).toBe(true)
    expect(privateResearchAddress("172.16.1.1")).toBe(true)
    expect(privateResearchAddress("192.168.1.1")).toBe(true)
    expect(privateResearchAddress("169.254.1.1")).toBe(true)
    expect(privateResearchAddress("::1")).toBe(true)
    expect(privateResearchAddress("::ffff:127.0.0.1")).toBe(true)
    expect(privateResearchAddress("8.8.8.8")).toBe(false)
    expect(privateResearchAddress("2606:4700:4700::1111")).toBe(false)
  })
})
