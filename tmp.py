# 任意の日程のレースについて直前情報やオッズの情報が記載されたURLを取得する
def get_url(date, place_cd, race_no, content):
    """
    content (str): ['odds3t', 'odds3f', 'odds2tf', 'beforeinfo']
    """
    url_t = 'https://www.boatrace.jp/owpc/pc/race/'
    ymd = str(pd.to_datetime(date)).split()[0].replace('-', '')
    jcd = f'0{place_cd}' if place_cd < 10 else str(place_cd)
    url = f'{url_t}{content}?rno={race_no}&jcd={jcd}&hd={ymd}'
    return url

# 直前情報のサイトからHTMLを取得し解析する
def get_beforeinfo(date, place_cd, race_no):
    url = get_url(date, place_cd, race_no, 'beforeinfo')
    soup = BeautifulSoup(requests.get(url).text, 'lxml')

    arr1 = arr1 = [[tag('td')[4].text, tag('td')[5].text]
                   for tag in soup(class_='is-fs12')]
    arr1 = [[v if v != '\xa0' else '' for v in row] for row in arr1]
    arr2 = [[tag.find(class_=f'table1_boatImage1{k}').text
             for k in ('Number', 'Time')]
            for tag in soup(class_='table1_boatImage1')]
    arr2 = [[v.replace('F', '-') for v in row] for row in arr2]
    arr2 = [row + [i] for i, row in enumerate(arr2, 1)]
    arr2 = pd.DataFrame(arr2).sort_values(by=[0]).values[:, 1:]

    air_t, wind_v, water_t, wave_h = [
        tag.text for tag in soup(class_='weather1_bodyUnitLabelData')]
    wether = soup(class_='weather1_bodyUnitLabelTitle')[1].text
    wind_d = int(soup.select_one(
        'p[class*="is-wind"]').attrs['class'][1][7:])

    df = pd.DataFrame(np.concatenate([arr1, arr2], 1),
                      columns=['ET', 'tilt', 'EST', 'ESC'])\
        .replace('L', '1').astype('float')
    if len(df) < 6:
        return None
    try:
        data = pd.concat([
            pd.Series(
                {'date': date, 'place_cd': place_cd, 'race_no': race_no}),
            pd.Series(df.values.T.reshape(-1),
                      index=[f'{col}_{i}' for col in df.columns
                             for i in range(1, 7)]),
            pd.Series({
                'wether': wether, 'air_t': float(air_t[:-1]),
                'wind_d': wind_d, 'wind_v': float(wind_v[:-1]),
                'water_t': float(water_t[:-1]),
                'wave_h': float(wave_h[:-2])})])
        for i in range(1, 7):
            data[f'ESC_{i}'] = int(data[f'ESC_{i}'])
        return data
    except ValueError:
        return None

date = '2025-11-27'
place_cd = 22
race_no = 1
bi = get_beforeinfo(date, place_cd, race_no)
print(bi)
