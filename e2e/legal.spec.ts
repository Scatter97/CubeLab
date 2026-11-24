import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const TIMER = '[data-testid="timer-surface"]'

async function waitForApp(page: Page) {
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
}

async function holdSpace(page: Page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })
  await page.keyboard.down('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'ready', {
    timeout: 3_000,
  })
  await page.keyboard.up('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
}

test.describe('public legal pages', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('serve both standalone pages directly, on refresh, and between each other', async ({
    page,
  }) => {
    await page.goto('/privacy')
    await expect(page.locator('h1')).toHaveText('Privacy Policy')
    await expect(page.locator('#root')).toHaveCount(0)
    await expect(page.locator('.onboarding-panel')).toHaveCount(0)
    await expect(page.locator(TIMER)).toHaveCount(0)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://cubelab-beryl.vercel.app/privacy',
    )
    expect(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
    ).toBe(0)
    expect(
      await page.evaluate(async () =>
        navigator.locks ? (await navigator.locks.query()).held.length : 0,
      ),
    ).toBe(0)

    await page.reload()
    await expect(page.locator('h1')).toHaveText('Privacy Policy')

    await page
      .locator('.footer-links')
      .getByRole('link', { name: 'Terms of Service' })
      .click()
    await expect(page).toHaveURL(/\/terms$/)
    await expect(page.locator('h1')).toHaveText('Terms of Service')

    await page.reload()
    await expect(page.locator('h1')).toHaveText('Terms of Service')

    await page
      .locator('.footer-links')
      .getByRole('link', { name: 'Privacy Policy' })
      .click()
    await expect(page).toHaveURL(/\/privacy$/)

    await page.getByRole('link', { name: 'Back to CubeLab' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('onboarding-skip')).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page
        .locator('.onboarding-legal-links')
        .getByRole('link', { name: 'Privacy Policy' }),
    ).toBeVisible()
    await expect(
      page
        .locator('.onboarding-legal-links')
        .getByRole('link', { name: 'Terms of Service' }),
    ).toBeVisible()
  })

  test('contain the required Google, retention, and contact disclosures', async ({
    page,
  }) => {
    await page.goto('/privacy')
    const privacy = page.locator('main')
    await expect(privacy).toContainText('drive.appdata')
    await expect(privacy).toContainText('Google API Services User Data Policy')
    await expect(privacy).toContainText('Limited Use')
    await expect(privacy).toContainText('Online Battle')
    await expect(privacy).toContainText('Reset All Site Data')
    await expect(privacy).toContainText('JoshHTML5@gmail.com')
    await expect(
      privacy.getByRole('link', { name: 'Google API Services User Data Policy' }),
    ).toHaveAttribute(
      'href',
      'https://developers.google.com/terms/api-services-user-data-policy',
    )

    await page.goto('/terms')
    const terms = page.locator('main')
    await expect(terms).toContainText('Online Battle')
    await expect(terms).toContainText('Google Drive')
    await expect(terms).toContainText('Disclaimer of warranties')
    await expect(terms).toContainText('Ontario')
    await expect(terms).toContainText('JoshHTML5@gmail.com')
  })

  test('honor light and dark system themes and remain readable at desktop, tablet, and mobile widths', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/privacy')
    expect(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    ).toBe('rgb(13, 18, 24)')

    await page.emulateMedia({ colorScheme: 'light' })
    await page.reload()
    expect(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    ).toBe('rgb(233, 237, 241)')

    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/privacy')
      await expect(page.locator('h1')).toBeVisible()
      await expect(page.locator('.toc')).toBeVisible()
      await expect(page.locator('.footer-links')).toBeVisible()
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
      ).toBe(false)
    }
  })

  test('have a keyboard skip link and no serious automated accessibility violations', async ({
    page,
  }) => {
    await page.goto('/privacy')
    await page.keyboard.press('Tab')
    await expect(page.locator('.skip-link')).toBeFocused()

    const privacyAudit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(
      privacyAudit.violations.filter(
        (violation) =>
          violation.impact === 'serious' || violation.impact === 'critical',
      ),
    ).toEqual([])

    await page.goto('/terms')
    const termsAudit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(
      termsAudit.violations.filter(
        (violation) =>
          violation.impact === 'serious' || violation.impact === 'critical',
      ),
    ).toEqual([])
  })
})

test.describe('CubeLab legal links', () => {
  test('appear in the timer footer and open the standalone pages in new tabs', async ({
    page,
  }) => {
    await page.goto('/')
    await waitForApp(page)

    const footerLinks = page.locator('.app-legal-links')
    await expect(footerLinks).toBeVisible()
    const privacy = footerLinks.getByRole('link', { name: 'Privacy Policy' })
    const terms = footerLinks.getByRole('link', { name: 'Terms of Service' })
    await expect(privacy).toHaveAttribute('href', '/privacy')
    await expect(privacy).toHaveAttribute('target', '_blank')
    await expect(privacy).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(terms).toHaveAttribute('href', '/terms')
    await expect(terms).toHaveAttribute('target', '_blank')
    await expect(terms).toHaveAttribute('rel', 'noopener noreferrer')

    const [privacyPopup] = await Promise.all([
      page.waitForEvent('popup'),
      privacy.click(),
    ])
    await privacyPopup.waitForLoadState('domcontentloaded')
    expect(privacyPopup.url()).toBe('http://127.0.0.1:4173/privacy')
    await expect(privacyPopup.locator('h1')).toHaveText('Privacy Policy')
    await privacyPopup.close()

    await terms.focus()
    const [termsPopup] = await Promise.all([
      page.waitForEvent('popup'),
      page.keyboard.press('Enter'),
    ])
    await termsPopup.waitForLoadState('domcontentloaded')
    expect(termsPopup.url()).toBe('http://127.0.0.1:4173/terms')
    await expect(termsPopup.locator('h1')).toHaveText('Terms of Service')
    await termsPopup.close()
  })

  test('appear at the bottom of Settings → About and are keyboard accessible', async ({
    page,
  }) => {
    await page.goto('/')
    await waitForApp(page)
    await page.getByTestId('settings-button').click()

    const about = page.locator('section[aria-labelledby="settings-about-title"]')
    const legal = about.locator('.settings-legal-links')
    await expect(legal).toBeVisible()
    await expect(legal.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/privacy',
    )
    await expect(legal.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      '/terms',
    )
    expect(
      await about.evaluate(
        (element) =>
          element.lastElementChild?.classList.contains(
            'settings-legal-links',
          ) ?? false,
      ),
    ).toBe(true)

    const privacy = legal.getByRole('link', { name: 'Privacy Policy' })
    await privacy.focus()
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.keyboard.press('Enter'),
    ])
    await popup.waitForLoadState('domcontentloaded')
    expect(popup.url()).toBe('http://127.0.0.1:4173/privacy')
    await expect(popup.locator('h1')).toHaveText('Privacy Policy')
    await popup.close()
  })

  test('opening a legal page does not interrupt a running solve', async ({
    page,
  }) => {
    await page.goto('/')
    await waitForApp(page)
    await holdSpace(page)

    const [legal] = await Promise.all([
      page.waitForEvent('popup'),
      page
        .locator('.app-legal-links')
        .getByRole('link', { name: 'Privacy Policy' })
        .click(),
    ])
    await legal.waitForLoadState('domcontentloaded')
    await expect(legal.locator('h1')).toHaveText('Privacy Policy')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')

    await page.keyboard.press('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
    await legal.close()
  })

  test('the service worker does not replace a legal navigation with the app shell', async ({
    page,
  }) => {
    await page.goto('/')
    await waitForApp(page)
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    await expect
      .poll(
        () =>
          page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
        { timeout: 15_000 },
      )
      .toBe(true)

    await page.goto('/privacy')
    await expect(page.locator('h1')).toHaveText('Privacy Policy')
    await expect(page.locator('#root')).toHaveCount(0)
    await expect(page.locator(TIMER)).toHaveCount(0)
  })
})
