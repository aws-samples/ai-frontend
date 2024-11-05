import uuid
import random
from datetime import datetime, timedelta
import csv
import numpy as np

# Generate 5 fixed user IDs
users = [str(uuid.uuid4()) for _ in range(5)]

# Generate 100 document IDs
document_ids = [str(uuid.uuid4()) for _ in range(100)]


def generate_learning_data(num_rows, doc_weights):
    # Prepare weighted random choice
    doc_types = list(doc_weights.keys())
    probabilities = list(doc_weights.values())

    # Start date: 6 months ago
    start_date = datetime.now() - timedelta(days=180)

    data = []
    for _ in range(num_rows):
        # Random timestamp within last 6 months
        random_days = random.randint(0, 180)
        random_seconds = random.randint(0, 86400)  # seconds in a day
        timestamp = start_date + timedelta(days=random_days, seconds=random_seconds)

        row = {
            'user_id': random.choice(users),
            'timestamp': timestamp.strftime('%Y-%m-%d %H:%M:%S'),
            'document_id': random.choice(document_ids),
            'document_type': np.random.choice(doc_types, p=probabilities)
        }
        data.append(row)

    return data


def validate_and_adjust_weights(weights):
    total = sum(weights.values())
    if not np.isclose(total, 1.0, rtol=1e-5):
        print(f"Warning: Weights sum to {total}, normalizing to 1.0")
        return {k: v/total for k, v in weights.items()}
    return weights


def main():
    # Adjustable weights
    custom_weights = {
        'image': 0.3,
        'text_technical': 0.1,
        'text_literary': 0.05,
        'text_simple_english': 0.35,
        'video': 0.02,
        'audio': 0.03,
        'multimedia': 0.15,
    }

    custom_weights = validate_and_adjust_weights(custom_weights)

    data = generate_learning_data(1000, custom_weights)

    data.sort(key=lambda x: x['timestamp'])

    OUTPUT_FILE = '../cdk/assets/user_learning_data.csv'
    with open(OUTPUT_FILE, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['user_id', 'timestamp', 'document_id', 'document_type'])
        writer.writeheader()
        writer.writerows(data)

    doc_counts = {}
    for row in data:
        doc_type = row['document_type']
        doc_counts[doc_type] = doc_counts.get(doc_type, 0) + 1
        print(row)

    print("\nActual distribution of document types:")
    for doc_type, count in sorted(doc_counts.items()):
        print(f"{doc_type}: {count/len(data):.3f} ({count} instances)")


if __name__ == "__main__":
    main()
