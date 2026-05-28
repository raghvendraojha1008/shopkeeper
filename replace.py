import os
import shutil

SOURCE_BASE = r"C:\Users\ragha\Downloads\files (98)"
TARGET_BASE = r"C:\Users\ragha\OneDrive\Desktop\shopkeeper-v2\src"

file_map = {
    "SeoHead.tsx": "components/common/SeoHead.tsx",
    "DashboardView.tsx": "components/views/DashboardView.tsx",

    "ExpenseRow.tsx": "components/cards/ExpenseRow.tsx",
    "LedgerCard.tsx": "components/cards/LedgerCard.tsx",
    "TransactionRow.tsx": "components/cards/TransactionRow.tsx",
    "PartyCard.tsx": "components/cards/PartyCard.tsx",

    "LoadingView.tsx": "components/views/LoadingView.tsx",
    "LockScreen.tsx": "components/common/LockScreen.tsx",

    "LoginView.tsx": "components/auth/LoginView.tsx",
    "OnboardingView.tsx": "components/auth/OnboardingView.tsx",

    "AppLayout.tsx": "components/layout/AppLayout.tsx",
}

replaced = 0
created = 0
missing = 0

for src, tgt in file_map.items():
    source_path = os.path.join(SOURCE_BASE, src)
    target_path = os.path.join(TARGET_BASE, tgt)

    if not os.path.exists(source_path):
        print(f"❌ Missing: {src}")
        missing += 1
        continue

    os.makedirs(os.path.dirname(target_path), exist_ok=True)

    if os.path.exists(target_path):
        shutil.copy2(source_path, target_path)
        print(f"🔁 Replaced: {tgt}")
        replaced += 1
    else:
        shutil.copy2(source_path, target_path)
        print(f"🆕 Created: {tgt}")
        created += 1

print("\n===== DONE =====")
print(f"Replaced: {replaced}")
print(f"Created: {created}")
print(f"Missing: {missing}")
