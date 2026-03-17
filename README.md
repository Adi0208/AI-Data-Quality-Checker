# AI Data Quality Checker

A browser-based tool that uses rule-based checks and **Claude AI** to detect data quality issues in CSV and Excel files — instantly, with no backend required.

Live Demo : https://adi0208.github.io/AI-Data-Quality-Checker/

## Features

| Check | Description |
|-------|-------------|
| 🔍 Missing values | Detects blank/null cells per column with % impact |
| ♻️ Duplicate rows | Finds exact duplicate records |
| 📋 Wrong format | Validates emails, dates, phone numbers, URLs |
| ⚠️ Invalid characters | Flags `\`, `<`, `>`, `\|`, control characters |
| 🔢 Mixed data types | Spots columns mixing text and numeric values |
| 📊 Statistical outliers | Z-score analysis (> 3 std deviations) |
| 🔒 Mandatory columns | Checks required columns exist and are non-empty |
| 🤖 AI deep analysis | Claude AI scans for semantic and logic issues |

## Demo

Upload the included `sample-data/sample_dirty_data.csv` to test all checks. Set mandatory columns to:

```
Campaign, Email, First Name, Last Name
```

## Project Structure

```
ai-data-quality-checker/
├── index.html              # Main app + landing page
├── css/
│   └── style.css           # All styles
├── js/
│   ├── checker.js          # Local rules engine (runs in browser)
│   └── app.js              # UI controller + AI API integration
├── assets/
│   └── favicon.svg
├── sample-data/
│   └── sample_dirty_data.csv   # Test file with intentional dirty data
└── README.md
```

## Setup

### Option 1 — Open directly in browser
Just open `index.html` in any modern browser. No server needed.

### Option 2 — Local server (recommended for API calls)
```bash
# Python
python -m http.server 8080

# Node.js
npx serve .
```

Then open `http://localhost:8080`.

## API Key

The AI analysis calls the [Anthropic Claude API](https://www.anthropic.com/api). To enable it:

1. Get an API key at [console.anthropic.com](https://console.anthropic.com)
2. The API call is made directly from the browser to `https://api.anthropic.com/v1/messages`

> **Note for production:** Do not expose API keys in a public frontend. For production use, proxy requests through your own backend. This project is intended as a portfolio demo.

## How It Works

```
Upload CSV/Excel
       ↓
  Parse in browser (PapaParse / SheetJS)
       ↓
  Local rules engine (checker.js)
  • Missing values
  • Duplicates
  • Format checks
  • Invalid chars
  • Mixed types
  • Outliers
  • Mandatory columns
       ↓
  Claude AI API call
  • Sample + metadata sent
  • Semantic + logic analysis
  • Quality score generated
       ↓
  Render results + export report
```

## Sample Data Issues

The included `sample_dirty_data.csv` deliberately contains:

- Duplicate rows (James Martin × 2, John Doe × 2)
- Invalid emails (`invalid-email`, `carol.jones@`, `test@test`)
- XSS attempt in Additional Information column
- Backslash characters in text fields
- Both Email Opt In and Opt Out set to `Yes` (logic contradiction)
- Mixed boolean types (`Yes/No` and `1/0` in same column)
- Missing mandatory fields (Campaign, Email, First Name)
- ALL CAPS email address
- Leading/trailing whitespace in names
- Statistical outlier value (`9999999999999`)

## Tech Stack

- **Vanilla HTML/CSS/JS** — zero framework dependencies
- **PapaParse** — CSV parsing
- **SheetJS (xlsx)** — Excel parsing
- **Claude API** — AI-powered deep analysis

## License

MIT — free to use, modify, and include in your portfolio.
