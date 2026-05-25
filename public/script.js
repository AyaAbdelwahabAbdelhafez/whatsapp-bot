const socket = io();
let allGroups = [];
let campaigns = [];
let editingId = null;

const connectionSpan = document.getElementById('connectionStatus');
const qrContainer = document.getElementById('qrCodeContainer');
const campaignsTbody = document.getElementById('campaignsList');
const refreshGroupsBtn = document.getElementById('refreshGroupsBtn');
const campaignForm = document.getElementById('campaignForm');
const groupsCheckboxesDiv = document.getElementById('groupsCheckboxes');
const groupsCountInfo = document.getElementById('groupsCountInfo');

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function (m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function renderGroupsCheckboxes(groups, selectedGroups = []) {
    groupsCheckboxesDiv.innerHTML = '';
    if (!groups || groups.length === 0) {
        groupsCheckboxesDiv.innerHTML = '<div class="alert alert-warning">⚠️ No groups found. Please join a WhatsApp group first.</div>';
        if (groupsCountInfo) groupsCountInfo.innerText = '';
        return;
    }
    if (groupsCountInfo) groupsCountInfo.innerText = `${groups.length} group(s) available`;
    groups.forEach(g => {
        const isSelected = selectedGroups.some(sg => sg.id === g.id);
        const div = document.createElement('div');
        div.className = 'form-check';
        div.innerHTML = `
            <input class="form-check-input" type="checkbox" value="${g.id}" data-name="${escapeHtml(g.name)}" ${isSelected ? 'checked' : ''}>
            <label class="form-check-label">${escapeHtml(g.name)}</label>
        `;
        groupsCheckboxesDiv.appendChild(div);
    });
}

async function loadGroups() {
    try {
        const res = await fetch('/api/groups');
        if (!res.ok) throw new Error('Failed to fetch groups');
        allGroups = await res.json();
        console.log('Groups loaded:', allGroups.length);
        return allGroups;
    } catch (err) {
        console.error(err);
        allGroups = [];
        return [];
    }
}

async function loadCampaigns() {
    const res = await fetch('/api/campaigns');
    campaigns = await res.json();
    renderCampaignsTable();
}

function renderCampaignsTable() {
    campaignsTbody.innerHTML = '';
    for (const camp of campaigns) {
        const row = campaignsTbody.insertRow();
        row.insertCell(0).innerText = camp.name;
        row.insertCell(1).innerHTML = camp.message.substring(0, 50) + (camp.message.length > 50 ? '...' : '');
        row.insertCell(2).innerText = new Date(camp.scheduleDate).toLocaleString();
        row.insertCell(3).innerText = camp.groups.map(g => g.name).join(', ').substring(0, 40);
        row.insertCell(4).innerHTML = camp.imagePath ? '<i class="fas fa-image text-success"></i>' : '<i class="fas fa-times text-danger"></i>';
        row.insertCell(5).innerHTML = camp.enabled ? (camp.executed ? '<span class="badge bg-secondary">Sent</span>' : '<span class="badge bg-primary">Scheduled</span>') : '<span class="badge bg-danger">Disabled</span>';
        const actions = row.insertCell(6);
        actions.innerHTML = `
            <button class="btn btn-sm btn-outline-primary me-1" onclick="editCampaign('${camp.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteCampaign('${camp.id}')"><i class="fas fa-trash"></i></button>
        `;
    }
}

window.openAddCampaign = async () => {
    groupsCheckboxesDiv.innerHTML = '<div class="text-muted"><i class="fas fa-spinner fa-spin"></i> Loading groups...</div>';
    if (groupsCountInfo) groupsCountInfo.innerText = '';
    await loadGroups();
    editingId = null;
    document.getElementById('campaignForm').reset();
    document.getElementById('campaignId').value = '';
    document.getElementById('campaignEnabled').checked = true;
    document.getElementById('minDelay').value = 5;
    document.getElementById('maxDelay').value = 15;
    renderGroupsCheckboxes(allGroups, []);
    const modal = new bootstrap.Modal(document.getElementById('campaignModal'));
    modal.show();
};

window.editCampaign = async (id) => {
    groupsCheckboxesDiv.innerHTML = '<div class="text-muted"><i class="fas fa-spinner fa-spin"></i> Loading groups...</div>';
    if (groupsCountInfo) groupsCountInfo.innerText = '';
    await loadGroups();
    const camp = campaigns.find(c => c.id === id);
    if (!camp) return;
    editingId = id;
    document.getElementById('campaignId').value = id;
    document.getElementById('campaignName').value = camp.name;
    document.getElementById('campaignMessage').value = camp.message;
    document.getElementById('campaignSchedule').value = camp.scheduleDate.slice(0, 16);
    document.getElementById('campaignEnabled').checked = camp.enabled;
    document.getElementById('minDelay').value = camp.minDelay || 5;
    document.getElementById('maxDelay').value = camp.maxDelay || 15;
    document.getElementById('campaignImage').value = '';
    renderGroupsCheckboxes(allGroups, camp.groups);
    const modal = new bootstrap.Modal(document.getElementById('campaignModal'));
    modal.show();
};

window.deleteCampaign = async (id) => {
    const confirm = await Swal.fire({
        title: 'Delete Campaign?',
        text: 'This action cannot be undone',
        icon: 'warning',
        showCancelButton: true
    });
    if (confirm.isConfirmed) {
        await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
        loadCampaigns();
        Swal.fire('Deleted!', 'Campaign has been deleted.', 'success');
    }
};

campaignForm.onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('campaignId').value;
    const name = document.getElementById('campaignName').value;
    const message = document.getElementById('campaignMessage').value;
    const scheduleDate = document.getElementById('campaignSchedule').value;
    const enabled = document.getElementById('campaignEnabled').checked;
    const imageFile = document.getElementById('campaignImage').files[0];
    const minDelay = document.getElementById('minDelay').value;
    const maxDelay = document.getElementById('maxDelay').value;

    const selected = [...groupsCheckboxesDiv.querySelectorAll('input:checked')].map(cb => {
        const group = allGroups.find(g => g.id === cb.value);
        return { id: group.id, name: group.name };
    });

    const formData = new FormData();
    formData.append('name', name);
    formData.append('message', message);
    formData.append('scheduleDate', scheduleDate);
    formData.append('groups', JSON.stringify(selected));
    formData.append('enabled', enabled);
    formData.append('minDelay', minDelay);
    formData.append('maxDelay', maxDelay);
    if (imageFile) formData.append('image', imageFile);

    let url = '/api/campaigns';
    let method = 'POST';
    if (id) {
        url = `/api/campaigns/${id}`;
        method = 'PUT';
    }

    const res = await fetch(url, { method, body: formData });
    if (res.ok) {
        bootstrap.Modal.getInstance(document.getElementById('campaignModal')).hide();
        loadCampaigns();
        Swal.fire('Saved!', 'Campaign has been saved.', 'success');
    } else {
        Swal.fire('Error', 'Could not save campaign', 'error');
    }
};

refreshGroupsBtn.onclick = async () => {
    refreshGroupsBtn.disabled = true;
    refreshGroupsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
    await fetch('/api/refresh-groups');
    await loadGroups();
    refreshGroupsBtn.disabled = false;
    refreshGroupsBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh Groups';
    Swal.fire('Refreshed', 'Groups list updated', 'success');
};

socket.on('qr', (qrImage) => {
    qrContainer.innerHTML = `<img src="${qrImage}" class="qr-img"><p class="mt-2">Scan with WhatsApp</p>`;
    connectionSpan.innerText = 'Scan QR Code';
});

socket.on('ready', () => {
    qrContainer.innerHTML = '<div class="alert alert-success">✅ Connected & Ready</div>';
    connectionSpan.innerText = 'Online';
    loadGroups();
    loadCampaigns();
});

socket.on('campaigns_updated', () => loadCampaigns());
socket.on('groups_ready', (groups) => {
    allGroups = groups;
    renderGroupsCheckboxes(allGroups, []);
    if (groupsCountInfo) groupsCountInfo.innerText = `${groups.length} group(s) available`;
});

loadGroups();
loadCampaigns();