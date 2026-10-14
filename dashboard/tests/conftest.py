import sys
from pathlib import Path

# Make the `server` package importable (dashboard/ on the path).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
