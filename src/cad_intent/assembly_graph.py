"""装配连接图分析：可达性 + 无环性。"""


def check_connectivity(assembly, ground_component_id, errors):
    """可达性 + 无环性：从基准 component 出发遍历连接图。"""
    if not isinstance(assembly, dict):
        return
    comp_ids = set()
    for comp in assembly.get('components') or []:
        if isinstance(comp, dict) and isinstance(comp.get('id'), str):
            comp_ids.add(comp['id'])
    if not comp_ids:
        return

    # 邻接表：每个 connection 视为一条边（contact 第一零件连其余，多接触面不产生多条边）
    adj = {cid: set() for cid in comp_ids}
    edge_count = 0
    for conn in assembly.get('connections') or []:
        if not isinstance(conn, dict):
            continue
        parts_in = []
        for c in conn.get('contact') or []:
            if isinstance(c, dict) and isinstance(c.get('part'), str):
                parts_in.append(c['part'])
        if len(parts_in) < 2:
            continue
        a = parts_in[0]
        for b in parts_in[1:]:
            if a in adj and b in adj and b not in adj[a]:
                adj[a].add(b)
                adj[b].add(a)
        edge_count += 1

    # 无环性：无环装配的连接图为森林，边数 < 节点数
    if edge_count >= len(comp_ids):
        errors.append('连接图存在环：无环装配要求连接图为树（边数 ' + str(edge_count)
                      + ' >= 节点数 ' + str(len(comp_ids)) + '）。')

    # 可达性：从基准零件对应 component BFS
    if ground_component_id not in adj:
        if comp_ids:
            errors.append("基准 component '" + str(ground_component_id) + "' 未在 components 中找到。")
        return
    visited = set()
    stack = [ground_component_id]
    while stack:
        cur = stack.pop()
        if cur in visited:
            continue
        visited.add(cur)
        for nxt in adj[cur]:
            if nxt not in visited:
                stack.append(nxt)
    for cid in comp_ids:
        if cid not in visited:
            errors.append("component '" + str(cid) + "' 不可达：未通过任何连接与基准零件连通。")
