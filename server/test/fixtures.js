import fs from 'node:fs/promises'
import path from 'node:path'

export const bulletinHtml = `<!doctype html><html><body>
<p>年末全国人口[5]140489 万人，比上年末减少339万人，其中城镇常住人口 95380 万人。全年出生人口 792 万人，出生率为 5.63‰；死亡人口 1131 万人，死亡率为 8.04‰；自然增长率为-2.41‰。</p>
<table><tbody>
<tr><td>全国人口</td><td>140489</td><td>100.0</td></tr>
<tr><td>其中：城镇</td><td>95380</td><td>67.9</td></tr>
<tr><td>乡村</td><td>45109</td><td>32.1</td></tr>
<tr><td>其中：男性</td><td>71685</td><td>51.0</td></tr>
<tr><td>女性</td><td>68804</td><td>49.0</td></tr>
<tr><td>其中：0—15 岁（含不满 16 周岁）</td><td>23015</td><td>16.4</td></tr>
<tr><td>16—59 岁（含不满 60 周岁）</td><td>85136</td><td>60.6</td></tr>
<tr><td>60 周岁及以上</td><td>32338</td><td>23.0</td></tr>
<tr><td>其中：65 周岁及以上</td><td>22365</td><td>15.9</td></tr>
</tbody></table></body></html>`

export const sampleSurveyHtml = `<!doctype html><html><body>
<p>全国人口为 140545 万人，其中男性人口为71722万人。</p>
<p>全国共有家庭户[4]51465 万户，家庭户人口为 129685 万人。平均每个家庭户人口为 2.52 人。</p>
<p>全国人口中，流动人口为 35788 万人。</p>
</body></html>`

export async function loadProjectData() {
  const dataRoot = path.resolve('data')
  return Promise.all([
    fs.readFile(path.join(dataRoot, 'sources.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(dataRoot, 'bootstrap.json'), 'utf8').then(JSON.parse),
  ])
}
