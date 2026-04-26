/**
 * EtsyTrue Landing Page — Interactive Calculator & UI
 * Vanilla JS, no dependencies.
 */

// ── Navbar scroll behaviour ───────────────────────────────────────────────────

const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

// ── Mobile menu ───────────────────────────────────────────────────────────────

const hamburger  = document.getElementById('nav-hamburger');
const navMobile  = document.getElementById('nav-mobile');

hamburger.addEventListener('click', () => {
  const open = navMobile.classList.toggle('open');
  hamburger.setAttribute('aria-expanded', open);
});

// Close mobile menu on link click
navMobile.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => navMobile.classList.remove('open'));
});

// ── Calculator ────────────────────────────────────────────────────────────────

const ETSY_TRANSACTION_RATE = 0.065;  // 6.5% of sale price
const ETSY_PAYMENT_RATE     = 0.03;   // 3% of sale price (US)
const ETSY_PAYMENT_FIXED    = 0.25;   // $0.25 per order (US)
const ETSY_LISTING_FEE      = 0.20;   // $0.20 per listing

// Slider elements
const sliderPrice    = document.getElementById('slider-price');
const sliderMaterial = document.getElementById('slider-material');
const sliderHours    = document.getElementById('slider-hours');
const sliderRate     = document.getElementById('slider-rate');

// Display labels
const valPrice    = document.getElementById('val-price');
const valMaterial = document.getElementById('val-material');
const valHours    = document.getElementById('val-hours');
const valRate     = document.getElementById('val-rate');

// Result elements
const resPrice       = document.getElementById('res-price');
const resTransaction = document.getElementById('res-transaction');
const resPayment     = document.getElementById('res-payment');
const resListing     = document.getElementById('res-listing');
const resMaterial    = document.getElementById('res-material');
const resLabor       = document.getElementById('res-labor');
const resProfit      = document.getElementById('res-profit');
const resMargin      = document.getElementById('res-margin');
const profitBar      = document.getElementById('profit-bar');
const profitVerdict  = document.getElementById('profit-verdict');
const verdictIcon    = document.getElementById('verdict-icon');
const verdictText    = document.getElementById('verdict-text');

// Track previous profit for animation direction
let prevProfit = null;

/**
 * Format a dollar value with sign and 2 decimal places.
 * @param {number} n
 * @param {boolean} [showSign=false]
 */
function fmtDollar(n, showSign = false) {
  const abs = Math.abs(n).toFixed(2);
  if (showSign && n >= 0) return `+$${abs}`;
  if (n < 0) return `−$${abs}`;
  return `$${abs}`;
}

/**
 * Animate a numeric text change with a brief flash class.
 * @param {HTMLElement} el
 * @param {string} newText
 * @param {string} [flashClass='flash']
 */
function animateValue(el, newText) {
  if (el.textContent === newText) return;
  el.classList.remove('flash');
  // Force reflow so re-adding class triggers animation
  void el.offsetWidth;
  el.textContent = newText;
  el.classList.add('flash');
}

function calculate() {
  const price    = parseFloat(sliderPrice.value);
  const material = parseFloat(sliderMaterial.value);
  const hours    = parseFloat(sliderHours.value);
  const rate     = parseFloat(sliderRate.value);

  // Update label displays
  valPrice.textContent    = `$${price}`;
  valMaterial.textContent = `$${material}`;
  valHours.textContent    = `${hours} hr${hours === 1 ? '' : 's'}`;
  valRate.textContent     = `$${rate}/hr`;

  // Update range slider fill progress visually
  updateSliderFill(sliderPrice,    price,    5,   100);
  updateSliderFill(sliderMaterial, material, 0,   50);
  updateSliderFill(sliderHours,    hours,    0,   4);
  updateSliderFill(sliderRate,     rate,     10,  50);

  // Fee calculations
  const transactionFee = price * ETSY_TRANSACTION_RATE;
  const paymentFee     = price * ETSY_PAYMENT_RATE + ETSY_PAYMENT_FIXED;
  const listingFee     = ETSY_LISTING_FEE;
  const laborCost      = hours * rate;

  const totalCosts = transactionFee + paymentFee + listingFee + material + laborCost;
  const trueProfit = price - totalCosts;
  const margin     = price > 0 ? (trueProfit / price) * 100 : 0;

  // Update result fields
  animateValue(resPrice,       `$${price.toFixed(2)}`);
  animateValue(resTransaction, `−$${transactionFee.toFixed(2)}`);
  animateValue(resPayment,     `−$${paymentFee.toFixed(2)}`);
  animateValue(resListing,     `−$${listingFee.toFixed(2)}`);
  animateValue(resMaterial,    `−$${material.toFixed(2)}`);
  animateValue(resLabor,       `−$${laborCost.toFixed(2)}`);

  // Profit — coloured
  const profitText = trueProfit >= 0 ? `$${trueProfit.toFixed(2)}` : `−$${Math.abs(trueProfit).toFixed(2)}`;
  animateValue(resProfit, profitText);

  const marginText = `${Math.max(margin, 0).toFixed(1)}%`;
  animateValue(resMargin, marginText);

  // Colour coding
  let profitColor, barColor, verdict, icon;

  if (margin > 25) {
    profitColor = '#059669';
    barColor    = '#059669';
    verdict     = 'Strong margin — your pricing is healthy!';
    icon        = '🌟';
  } else if (margin >= 10) {
    profitColor = '#D97706';
    barColor    = '#D97706';
    verdict     = 'Acceptable margin — room to optimise.';
    icon        = '✅';
  } else if (margin > 0) {
    profitColor = '#DC2626';
    barColor    = '#DC2626';
    verdict     = 'Low margin — consider raising your price.';
    icon        = '📊';
  } else {
    profitColor = '#DC2626';
    barColor    = '#DC2626';
    verdict     = 'Losing money on this sale — raise price or lower costs.';
    icon        = '⚠️';
  }

  resProfit.style.color  = profitColor;
  resMargin.style.color  = profitColor;
  profitBar.style.background = barColor;
  verdictIcon.textContent = icon;
  verdictText.textContent = verdict;

  // Bar width: clamp margin 0–60%
  const barWidth = Math.min(Math.max(margin, 0), 60) / 60 * 100;
  profitBar.style.width = `${barWidth.toFixed(1)}%`;

  prevProfit = trueProfit;
}

/**
 * Update the background gradient on a range slider to show fill progress.
 */
function updateSliderFill(slider, value, min, max) {
  const pct = ((value - min) / (max - min)) * 100;
  slider.style.background =
    `linear-gradient(to right, var(--brand) 0%, var(--brand) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`;
}

// Attach listeners
[sliderPrice, sliderMaterial, sliderHours, sliderRate].forEach(s => {
  s.addEventListener('input', calculate);
});

// Initial render
calculate();

// ── FAQ Accordion ─────────────────────────────────────────────────────────────

document.querySelectorAll('.faq-question').forEach(btn => {
  btn.addEventListener('click', () => {
    const item   = btn.closest('.faq-item');
    const isOpen = item.classList.contains('open');

    // Close all
    document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));

    // Toggle current
    if (!isOpen) item.classList.add('open');
  });
});

// ── Smooth scroll for anchor links ────────────────────────────────────────────

document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', e => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// ── Flash animation style (injected) ─────────────────────────────────────────

const style = document.createElement('style');
style.textContent = `
  @keyframes flash-in {
    0%   { opacity: .4; transform: translateY(-3px); }
    100% { opacity: 1;  transform: translateY(0); }
  }
  .flash { animation: flash-in .22s ease forwards; }
  .navbar.scrolled { box-shadow: 0 1px 12px rgba(0,0,0,.08); }
`;
document.head.appendChild(style);
