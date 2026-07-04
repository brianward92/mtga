"""Which sets/formats the draft assistant tracks, and 17Lands endpoints.

Edit TRACKED_SETS as new sets release. Bulk S3 files are CC BY 4.0 and the
sanctioned bulk path; the site JSON endpoints may be hit at most once per day
per (set, format) and must be cached (see mtga/lands/download.py guards).
Attribution requirement: anything user-facing shows "Data from 17Lands.com".
"""

TRACKED_SETS = ["MSH", "SOS"]

FORMATS = ["PremierDraft", "TradDraft"]

DATA_TYPES = ["draft", "game"]  # replay excluded: 300+MB/set, unused in v1

# Serving-time fallbacks: which trained model a format may borrow.
# QuickDraft has essentially no public draft data (one VOW dump ever), and
# TradDraft data is small; both are served by the Premier-trained model.
FORMAT_FALLBACKS = {
    "PremierDraft": [],
    "TradDraft": ["PremierDraft"],
    "QuickDraft": ["PremierDraft"],
    "Sealed": [],
    "TradSealed": [],
}

S3_BASE = "https://17lands-public.s3.amazonaws.com/analysis_data"
SITE_BASE = "https://www.17lands.com"

USER_AGENT = "mtga/0.2 (brian.ward.92@gmail.com)"
REQUEST_TIMEOUT = 60

ATTRIBUTION = "Data from 17Lands.com (CC BY 4.0)"
