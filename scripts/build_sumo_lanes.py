#!/usr/bin/env python3
"""
Compute hierarchy-aware lane_order and cat_depth for sumo_tag_categories.json.
X lane = L1 (Abstract left, Physical right) → L2 subgroup → alphabetical
Y depth = ancestor count (depth from Entity root)
"""
import json, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIER_FILE = os.path.join(BASE, 'ontology', 'sumo_hierarchy.json')
CATS_FILE  = os.path.join(BASE, 'ontology', 'sumo_tag_categories.json')

with open(HIER_FILE) as f:
    hierarchy = json.load(f)  # concept -> [parent, ...]

with open(CATS_FILE) as f:
    cats_data = json.load(f)

cats = cats_data['categories']  # list of 99 category names

memo = {}
def ancestors(concept):
    if concept in memo:
        return memo[concept]
    parents = hierarchy.get(concept, [])
    if not parents:
        memo[concept] = []
        return []
    p = parents[0]  # primary parent
    path = ancestors(p) + [p]
    memo[concept] = path
    return path

# Build L1, L2, depth for each category
cat_info = {}
for c in cats:
    path = ancestors(c)
    # path[0]=Entity, path[1]=Abstract|Physical, path[2]=subgroup
    L1 = path[1] if len(path) > 1 else 'Unknown'
    L2 = path[2] if len(path) > 2 else c
    depth = len(path)  # number of ancestors = depth (Entity=0 means depth 1)
    cat_info[c] = {'L1': L1, 'L2': L2, 'depth': depth}

# Sort: Abstract first, Physical second, Unknown last; within each: L2 alpha, then cat alpha
L1_ORDER = {'Abstract': 0, 'Physical': 1}
def sort_key(c):
    info = cat_info[c]
    return (L1_ORDER.get(info['L1'], 2), info['L2'], c)

lane_order = sorted(cats, key=sort_key)

# cat_depth map: category -> depth (1-based ancestor count)
cat_depth = {c: cat_info[c]['depth'] for c in cats}

# L1/L2 group map for browser sub-group dividers
cat_groups = {c: {'L1': cat_info[c]['L1'], 'L2': cat_info[c]['L2']} for c in cats}

# Build L2 group order (deduped, preserving L1→L2 sort order)
l2_seen = set()
l2_order = []
for cat in lane_order:
    l2 = cat_info[cat]['L2']
    if l2 not in l2_seen:
        l2_seen.add(l2)
        l2_order.append(l2)

cats_data['lane_order'] = lane_order
cats_data['cat_depth']  = cat_depth
cats_data['cat_groups'] = cat_groups
cats_data['l2_order']   = l2_order  # 15 L2 subgroup lanes for X axis

with open(CATS_FILE, 'w') as f:
    json.dump(cats_data, f, separators=(',', ':'))

print(f"Written {len(lane_order)} categories to lane_order")
print(f"Depth range: {min(cat_depth.values())} - {max(cat_depth.values())}")

# Print layout preview
from collections import defaultdict
groups = defaultdict(lambda: defaultdict(list))
for c in lane_order:
    info = cat_info[c]
    groups[info['L1']][info['L2']].append(c)

for L1 in ['Abstract', 'Physical', 'Unknown']:
    if L1 not in groups:
        continue
    print(f"\n=== {L1} ===")
    for L2, cs in groups[L1].items():
        depths = [cat_depth[c] for c in cs]
        print(f"  {L2} (depth {min(depths)}-{max(depths)}): {len(cs)} cats")
