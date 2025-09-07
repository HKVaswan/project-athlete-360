---
layout: default
title: "Categories"
permalink: /categories/
---

<h1>Categories</h1>

{% assign categories = site.categories %}
<ul>
  {% for category in categories %}
    <li>
      <h2 id="{{ category[0] }}">{{ category[0] | capitalize }}</h2>
      <ul>
        {% for post in category[1] %}
          <li>
            <a href="{{ post.url | relative_url }}">{{ post.title }}</a>
            <small>{{ post.date | date: "%B %d, %Y" }}</small>
          </li>
        {% endfor %}
      </ul>
    </li>
  {% endfor %}
</ul>
